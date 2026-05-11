package controller

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"

	"github.com/bytedance/gopkg/util/gopool"
)

const (
	cpaCooldownTag        = "cpa"
	cpaCooldownSeconds    = int64(24 * 60 * 60)
	cpaCooldownCheckEvery = 5 * time.Minute
	cpaCooldownUntilKey   = "cpa_cooldown_until"
	cpaCooldownReasonKey  = "cpa_cooldown_reason"
	cpaLastProbeKey       = "cpa_last_probe"
	cpaLastProbeErrorKey  = "cpa_last_probe_error"
	cpaModelCooldownsKey  = "cpa_model_cooldowns"
)

var cpaCooldownTaskOnce sync.Once

func StartCPAChannelCooldownTask() {
	cpaCooldownTaskOnce.Do(func() {
		gopool.Go(func() {
			time.Sleep(30 * time.Second)
			runCPAChannelCooldownProbeOnce()
			ticker := time.NewTicker(cpaCooldownCheckEvery)
			defer ticker.Stop()
			for range ticker.C {
				runCPAChannelCooldownProbeOnce()
			}
		})
	})
}

func handleCPAChannelCooldown(channelError types.ChannelError, modelName string, err *types.NewAPIError) bool {
	if err == nil {
		return false
	}
	channel, getErr := model.GetChannelById(channelError.ChannelId, true)
	if getErr != nil {
		common.SysLog(fmt.Sprintf("CPA channel cooldown lookup failed: channel_id=%d, error=%v", channelError.ChannelId, getErr))
		return false
	}
	if !isCPAChannel(channel) {
		return false
	}

	if err.StatusCode == http.StatusTooManyRequests {
		disableCPAChannelFor24h(channel, "CPA 标签渠道请求返回 429", err)
		return true
	}
	if shouldCooldownCPAChannelForDeactivatedAccount(err) {
		disableCPAChannelFor24h(channel, "CPA 标签渠道账号被上游标记为 deactivated", err)
		return true
	}
	if shouldCooldownCPAModelForAuthUnavailable(err) {
		return disableCPAModelFor24h(channel, modelName, err)
	}
	return false
}

func disableCPAChannelFor24h(channel *model.Channel, prefix string, err *types.NewAPIError) {
	until := common.GetTimestamp() + cpaCooldownSeconds
	reason := fmt.Sprintf("%s，自动冷却 24h：%s", prefix, err.ErrorWithStatusCode())
	changed, updateErr := model.ForceUpdateChannelStatus(channel.Id, common.ChannelStatusAutoDisabled, reason, map[string]interface{}{
		cpaCooldownUntilKey:  until,
		cpaCooldownReasonKey: reason,
		cpaLastProbeErrorKey: nil,
	})
	if updateErr != nil {
		common.SysLog(fmt.Sprintf("CPA channel cooldown update failed: channel_id=%d, error=%v", channel.Id, updateErr))
		return
	}
	common.SysLog(fmt.Sprintf("CPA channel #%d (%s) disabled until %s: %s", channel.Id, channel.Name, time.Unix(until, 0).Format(time.RFC3339), prefix))
	if changed {
		service.NotifyRootUser(
			fmt.Sprintf("%s_%d_cpa_cooldown", dto.NotifyTypeChannelUpdate, channel.Id),
			fmt.Sprintf("CPA 通道「%s」（#%d）已冷却", channel.Name, channel.Id),
			reason,
		)
	}
}

func disableCPAModelFor24h(channel *model.Channel, modelName string, err *types.NewAPIError) bool {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		modelName = extractModelFromErrorMessage(err.Error())
	}
	if modelName == "" {
		common.SysLog(fmt.Sprintf("CPA model cooldown skipped: channel_id=%d has no model name, error=%s", channel.Id, err.ErrorWithStatusCode()))
		return false
	}
	until := common.GetTimestamp() + cpaCooldownSeconds
	reason := fmt.Sprintf("CPA 标签渠道模型 %s 返回 auth_unavailable/no auth available，自动冷却 24h：%s", modelName, err.ErrorWithStatusCode())
	info := channel.GetOtherInfo()
	cooldowns := getCPAModelCooldowns(info)
	cooldowns[modelName] = map[string]interface{}{
		"until":      until,
		"reason":     reason,
		"last_error": err.ErrorWithStatusCode(),
	}
	info[cpaModelCooldownsKey] = cooldowns
	info["status_reason"] = reason
	info["status_time"] = common.GetTimestamp()
	channel.SetOtherInfo(info)
	if err := channel.SaveWithoutKey(); err != nil {
		common.SysLog(fmt.Sprintf("CPA model cooldown metadata save failed: channel_id=%d model=%s error=%v", channel.Id, modelName, err))
		return false
	}
	if err := model.UpdateAbilityStatusByChannelModel(channel.Id, modelName, false); err != nil {
		common.SysLog(fmt.Sprintf("CPA model cooldown ability update failed: channel_id=%d model=%s error=%v", channel.Id, modelName, err))
		return false
	}
	if common.MemoryCacheEnabled {
		model.InitChannelCache()
	}
	common.SysLog(fmt.Sprintf("CPA channel #%d (%s) model %s disabled until %s because auth is unavailable", channel.Id, channel.Name, modelName, time.Unix(until, 0).Format(time.RFC3339)))
	service.NotifyRootUser(
		fmt.Sprintf("%s_%d_%s_cpa_model_cooldown", dto.NotifyTypeChannelUpdate, channel.Id, modelName),
		fmt.Sprintf("CPA 通道「%s」（#%d）模型 %s 已冷却", channel.Name, channel.Id, modelName),
		reason,
	)
	return true
}

func runCPAChannelCooldownProbeOnce() {
	var channels []*model.Channel
	if err := model.DB.Where("LOWER(tag) = ?", cpaCooldownTag).Find(&channels).Error; err != nil {
		common.SysLog("CPA channel cooldown scan failed: " + err.Error())
		return
	}
	now := common.GetTimestamp()
	for _, channel := range channels {
		info := channel.GetOtherInfo()
		until, ok := numberInfo(info[cpaCooldownUntilKey])
		if channel.Status == common.ChannelStatusAutoDisabled && ok && until > 0 && now >= until {
			probeCPAChannel(channel)
			time.Sleep(common.RequestInterval)
		}
		probeCPAModelCooldowns(channel, now)
	}
}

func probeCPAChannel(channel *model.Channel) {
	result := testChannel(channel, "", "", false)
	if result.localErr == nil && result.newAPIError == nil {
		_, err := model.ForceUpdateChannelStatus(channel.Id, common.ChannelStatusEnabled, "CPA 标签渠道冷却后探测成功，自动启用", map[string]interface{}{
			cpaCooldownUntilKey:  nil,
			cpaCooldownReasonKey: nil,
			cpaLastProbeKey:      common.GetTimestamp(),
			cpaLastProbeErrorKey: nil,
		})
		if err != nil {
			common.SysLog(fmt.Sprintf("CPA channel #%d enable after probe failed: %v", channel.Id, err))
			return
		}
		common.SysLog(fmt.Sprintf("CPA channel #%d (%s) probe success, re-enabled", channel.Id, channel.Name))
		service.NotifyRootUser(
			fmt.Sprintf("%s_%d_cpa_enabled", dto.NotifyTypeChannelUpdate, channel.Id),
			fmt.Sprintf("CPA 通道「%s」（#%d）已恢复", channel.Name, channel.Id),
			"冷却 24h 后探测成功，已自动启用。",
		)
		return
	}

	message := "unknown error"
	if result.newAPIError != nil {
		message = result.newAPIError.ErrorWithStatusCode()
	} else if result.localErr != nil {
		message = result.localErr.Error()
	}
	nextUntil := common.GetTimestamp() + cpaCooldownSeconds
	reason := fmt.Sprintf("CPA 标签渠道冷却后探测失败，继续冷却 24h：%s", message)
	_, err := model.ForceUpdateChannelStatus(channel.Id, common.ChannelStatusAutoDisabled, reason, map[string]interface{}{
		cpaCooldownUntilKey:  nextUntil,
		cpaCooldownReasonKey: reason,
		cpaLastProbeKey:      common.GetTimestamp(),
		cpaLastProbeErrorKey: message,
	})
	if err != nil {
		common.SysLog(fmt.Sprintf("CPA channel #%d extend cooldown failed: %v", channel.Id, err))
		return
	}
	common.SysLog(fmt.Sprintf("CPA channel #%d (%s) probe failed, disabled until %s: %s", channel.Id, channel.Name, time.Unix(nextUntil, 0).Format(time.RFC3339), message))
}

func probeCPAModelCooldowns(channel *model.Channel, now int64) {
	if channel.Status != common.ChannelStatusEnabled {
		return
	}
	info := channel.GetOtherInfo()
	cooldowns := getCPAModelCooldowns(info)
	if len(cooldowns) == 0 {
		return
	}
	changed := false
	for modelName, raw := range cooldowns {
		entry, ok := raw.(map[string]interface{})
		if !ok {
			delete(cooldowns, modelName)
			changed = true
			continue
		}
		until, ok := numberInfo(entry["until"])
		if !ok || until <= 0 {
			delete(cooldowns, modelName)
			changed = true
			continue
		}
		if now < until {
			continue
		}
		result := testChannel(channel, modelName, "", false)
		if result.localErr == nil && result.newAPIError == nil {
			if err := model.UpdateAbilityStatusByChannelModel(channel.Id, modelName, true); err != nil {
				common.SysLog(fmt.Sprintf("CPA model cooldown re-enable failed: channel_id=%d model=%s error=%v", channel.Id, modelName, err))
				continue
			}
			delete(cooldowns, modelName)
			changed = true
			common.SysLog(fmt.Sprintf("CPA channel #%d (%s) model %s probe success, re-enabled", channel.Id, channel.Name, modelName))
			service.NotifyRootUser(
				fmt.Sprintf("%s_%d_%s_cpa_model_enabled", dto.NotifyTypeChannelUpdate, channel.Id, modelName),
				fmt.Sprintf("CPA 通道「%s」（#%d）模型 %s 已恢复", channel.Name, channel.Id, modelName),
				"模型冷却 24h 后探测成功，已自动恢复。",
			)
			continue
		}
		message := "unknown error"
		if result.newAPIError != nil {
			message = result.newAPIError.ErrorWithStatusCode()
		} else if result.localErr != nil {
			message = result.localErr.Error()
		}
		nextUntil := common.GetTimestamp() + cpaCooldownSeconds
		entry["until"] = nextUntil
		entry["last_probe"] = common.GetTimestamp()
		entry["last_error"] = message
		entry["reason"] = fmt.Sprintf("CPA 标签渠道模型 %s 冷却后探测失败，继续冷却 24h：%s", modelName, message)
		cooldowns[modelName] = entry
		changed = true
		common.SysLog(fmt.Sprintf("CPA channel #%d (%s) model %s probe failed, disabled until %s: %s", channel.Id, channel.Name, modelName, time.Unix(nextUntil, 0).Format(time.RFC3339), message))
		time.Sleep(common.RequestInterval)
	}
	if !changed {
		return
	}
	info[cpaModelCooldownsKey] = cooldowns
	channel.SetOtherInfo(info)
	if err := channel.SaveWithoutKey(); err != nil {
		common.SysLog(fmt.Sprintf("CPA model cooldown metadata save after probe failed: channel_id=%d error=%v", channel.Id, err))
	}
	if common.MemoryCacheEnabled {
		model.InitChannelCache()
	}
}

func isCPAChannel(channel *model.Channel) bool {
	if channel == nil {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(channel.GetTag()), cpaCooldownTag)
}

func isCPAChannelCooldownActive(channel *model.Channel) bool {
	if !isCPAChannel(channel) {
		return false
	}
	until, ok := numberInfo(channel.GetOtherInfo()[cpaCooldownUntilKey])
	return ok && until > common.GetTimestamp()
}

func shouldCooldownCPAModelForAuthUnavailable(err *types.NewAPIError) bool {
	if err == nil || err.StatusCode != http.StatusServiceUnavailable {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "auth_unavailable") && strings.Contains(message, "no auth available")
}

func shouldCooldownCPAChannelForDeactivatedAccount(err *types.NewAPIError) bool {
	if err == nil || err.StatusCode != http.StatusUnauthorized {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "openai account has been deactivated") ||
		strings.Contains(message, "account has been deactivated")
}

func extractModelFromErrorMessage(message string) string {
	lower := strings.ToLower(message)
	idx := strings.Index(lower, "model=")
	if idx < 0 {
		return ""
	}
	value := message[idx+len("model="):]
	for i, r := range value {
		if r == ')' || r == ',' || r == ' ' || r == '\n' || r == '\t' {
			value = value[:i]
			break
		}
	}
	return strings.TrimSpace(value)
}

func getCPAModelCooldowns(info map[string]interface{}) map[string]interface{} {
	raw, ok := info[cpaModelCooldownsKey]
	if !ok || raw == nil {
		return map[string]interface{}{}
	}
	switch typed := raw.(type) {
	case map[string]interface{}:
		return typed
	case map[string]map[string]interface{}:
		out := make(map[string]interface{}, len(typed))
		for key, value := range typed {
			out[key] = value
		}
		return out
	default:
		return map[string]interface{}{}
	}
}

func numberInfo(value interface{}) (int64, bool) {
	switch v := value.(type) {
	case int:
		return int64(v), true
	case int64:
		return v, true
	case int32:
		return int64(v), true
	case float64:
		return int64(v), true
	case float32:
		return int64(v), true
	case jsonNumber:
		n, err := v.Int64()
		return n, err == nil
	default:
		return 0, false
	}
}

type jsonNumber interface {
	Int64() (int64, error)
}
