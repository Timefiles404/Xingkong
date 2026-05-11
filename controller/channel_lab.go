package controller

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

type channelLabRequest struct {
	BaseURL       string   `json:"base_url"`
	Type          int      `json:"type"`
	Key           string   `json:"key"`
	Proxy         string   `json:"proxy"`
	SkipTLSVerify bool     `json:"skip_tls_verify"`
	Model         string   `json:"model"`
	Models        []string `json:"models"`
	EndpointType  string   `json:"endpoint_type"`
	Stream        bool     `json:"stream"`
}

type channelLabTestResponse struct {
	Success      bool                     `json:"success"`
	Model        string                   `json:"model"`
	EndpointType string                   `json:"endpoint_type"`
	Message      string                   `json:"message,omitempty"`
	Time         float64                  `json:"time"`
	Detail       *channelLabTestDetail    `json:"detail,omitempty"`
	Attempts     []*channelLabTestAttempt `json:"attempts,omitempty"`
}

type channelLabTestAttempt struct {
	EndpointType string                `json:"endpoint_type"`
	Success      bool                  `json:"success"`
	Message      string                `json:"message,omitempty"`
	Detail       *channelLabTestDetail `json:"detail,omitempty"`
}

type channelLabCPAImportRequest struct {
	Items []channelLabCPAImportItem `json:"items"`
}

type channelLabCPAImportItem struct {
	ClientID           string            `json:"client_id"`
	BaseURL            string            `json:"base_url"`
	Type               int               `json:"type"`
	Key                string            `json:"key"`
	Proxy              string            `json:"proxy"`
	SkipTLSVerify      bool              `json:"skip_tls_verify"`
	AvailableModels    []string          `json:"available_models"`
	ModelEndpointTypes map[string]string `json:"model_endpoint_types"`
}

type channelLabCPAImportResult struct {
	ClientID        string   `json:"client_id"`
	ID              int      `json:"id"`
	Name            string   `json:"name"`
	BaseURL         string   `json:"base_url"`
	AvailableModels []string `json:"available_models"`
}

func ChannelLabTest(c *gin.Context) {
	var req channelLabRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid request: " + err.Error()})
		return
	}
	req.Model = strings.TrimSpace(req.Model)
	if req.Model == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "模型不能为空"})
		return
	}
	result := runChannelLabTest(req, req.Model)
	c.JSON(http.StatusOK, result)
}

func ChannelLabTestAll(c *gin.Context) {
	var req channelLabRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid request: " + err.Error()})
		return
	}
	models := normalizeChannelLabModels(req.Models)
	if len(models) == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "模型列表不能为空"})
		return
	}

	results := make([]channelLabTestResponse, len(models))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 4)
	for i, modelName := range models {
		wg.Add(1)
		go func(idx int, name string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			results[idx] = runChannelLabTest(req, name)
		}(i, modelName)
	}
	wg.Wait()

	successItems := make([]channelLabTestResponse, 0)
	failedItems := make([]channelLabTestResponse, 0)
	for _, item := range results {
		if item.Success {
			successItems = append(successItems, item)
		} else {
			failedItems = append(failedItems, item)
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"success": successItems,
			"failed":  failedItems,
			"total":   len(results),
		},
	})
}

func ChannelLabImportCPAChannels(c *gin.Context) {
	var req channelLabCPAImportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid request: " + err.Error()})
		return
	}
	if len(req.Items) == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "没有可导入的渠道"})
		return
	}

	channels := make([]*model.Channel, 0, len(req.Items))
	for _, item := range req.Items {
		channel, err := buildChannelLabCPAChannel(item)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
			return
		}
		if err := channel.Insert(); err != nil {
			common.ApiError(c, err)
			return
		}
		channels = append(channels, channel)
	}
	service.ResetProxyClientCache()

	results := make([]channelLabCPAImportResult, 0, len(channels))
	for _, channel := range channels {
		clientID, _ := channel.GetOtherInfo()["client_id"].(string)
		results = append(results, channelLabCPAImportResult{
			ClientID:        clientID,
			ID:              channel.Id,
			Name:            channel.Name,
			BaseURL:         channel.GetBaseURL(),
			AvailableModels: channel.GetModels(),
		})
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": fmt.Sprintf("已导入 %d 个 CPA 渠道", len(channels)),
		"data": gin.H{
			"items": results,
			"total": len(results),
		},
	})
}

func runChannelLabTest(req channelLabRequest, modelName string) channelLabTestResponse {
	started := time.Now()
	channel := buildChannelLabTemporaryChannel(req, modelName)
	endpointTypes := channelLabEndpointCandidates(req, modelName)
	attempts := make([]*channelLabTestAttempt, 0, len(endpointTypes))

	var last channelLabTestResponse
	for _, endpointType := range endpointTypes {
		result := testChannelWithOptions(channel, modelName, endpointType, req.Stream, channelTestOptions{recordLog: false, collectDetail: true})
		response := channelLabResponseFromTest(modelName, endpointType, result, started)
		attempts = append(attempts, &channelLabTestAttempt{
			EndpointType: endpointType,
			Success:      response.Success,
			Message:      response.Message,
			Detail:       response.Detail,
		})
		last = response
		if response.Success {
			response.Attempts = attempts
			return response
		}
	}
	last.Attempts = attempts
	return last
}

func buildChannelLabTemporaryChannel(req channelLabRequest, modelName string) *model.Channel {
	baseURL := strings.TrimSpace(req.BaseURL)
	if baseURL == "" {
		baseURL = constant.ChannelBaseURLs[req.Type]
	}
	key := strings.TrimSpace(req.Key)
	key = strings.Split(key, "\n")[0]
	autoBan := 0
	priority := int64(0)
	channel := &model.Channel{
		Id:            0,
		Type:          req.Type,
		Key:           key,
		Name:          "渠道测试场临时渠道",
		Status:        common.ChannelStatusEnabled,
		BaseURL:       &baseURL,
		Models:        modelName,
		Group:         "default",
		CreatedTime:   common.GetTimestamp(),
		AutoBan:       &autoBan,
		Priority:      &priority,
		OtherSettings: "{}",
	}
	channel.SetSetting(dto.ChannelSettings{Proxy: strings.TrimSpace(req.Proxy), SkipTLSVerify: req.SkipTLSVerify})
	return channel
}

func buildChannelLabCPAChannel(item channelLabCPAImportItem) (*model.Channel, error) {
	baseURL := strings.TrimSpace(item.BaseURL)
	if baseURL == "" {
		return nil, fmt.Errorf("Base URL 不能为空")
	}
	key := normalizeChannelLabCSVKey(item.Key)
	if key == "" {
		return nil, fmt.Errorf("%s 的 API Key 不能为空", baseURL)
	}
	models := normalizeChannelLabModels(item.AvailableModels)
	if len(models) == 0 {
		return nil, fmt.Errorf("%s 没有可导入的可用模型", baseURL)
	}

	channelType := item.Type
	if channelType <= 0 || channelType >= constant.ChannelTypeDummy {
		channelType = constant.ChannelTypeOpenAI
	}
	autoBan := 1
	priority := int64(0)
	tag := "CPA"
	remark := "渠道测试场 CSV 自动导入"
	modelEndpointTypes := map[string]string{}
	for modelName, endpointType := range item.ModelEndpointTypes {
		modelName = strings.TrimSpace(modelName)
		endpointType = strings.TrimSpace(endpointType)
		if modelName != "" && endpointType != "" {
			modelEndpointTypes[modelName] = endpointType
		}
	}

	channel := &model.Channel{
		Type:          channelType,
		Key:           key,
		Name:          buildChannelLabCPAChannelName(models),
		Status:        common.ChannelStatusEnabled,
		BaseURL:       &baseURL,
		Models:        strings.Join(models, ","),
		Group:         "default",
		CreatedTime:   common.GetTimestamp(),
		AutoBan:       &autoBan,
		Priority:      &priority,
		Tag:           &tag,
		Remark:        &remark,
		OtherSettings: "{}",
	}
	channel.SetSetting(dto.ChannelSettings{Proxy: strings.TrimSpace(item.Proxy), SkipTLSVerify: item.SkipTLSVerify})
	channel.SetOtherSettings(dto.ChannelOtherSettings{})
	channel.OtherSettings = `{"profit_upstream_usd_per_cny":100}`
	channel.SetOtherInfo(map[string]interface{}{
		"source":               "channel_lab_csv_import",
		"client_id":            strings.TrimSpace(item.ClientID),
		"model_endpoint_types": modelEndpointTypes,
	})
	if err := validateChannel(channel, true); err != nil {
		return nil, err
	}
	return channel, nil
}

func buildChannelLabCPAChannelName(models []string) string {
	hasGPT := false
	hasClaude := false
	for _, modelName := range models {
		lower := strings.ToLower(modelName)
		if strings.Contains(lower, "gpt") {
			hasGPT = true
		}
		if strings.Contains(lower, "claude") || strings.Contains(lower, "opus") || strings.Contains(lower, "sonnet") {
			hasClaude = true
		}
	}
	suffix := "MODEL"
	if hasGPT && hasClaude {
		suffix = "GPTCLAUDE"
	} else if hasGPT {
		suffix = "GPT"
	} else if hasClaude {
		suffix = "CLAUDE"
	}
	return fmt.Sprintf("auto-%s-%s", strings.ToLower(common.GetRandomString(6)), suffix)
}

func normalizeChannelLabCSVKey(key string) string {
	key = strings.TrimSpace(key)
	key = strings.Split(key, "\n")[0]
	key = strings.TrimSpace(key)
	return strings.TrimPrefix(key, "sk-")
}

func channelLabEndpointCandidates(req channelLabRequest, modelName string) []string {
	manual := strings.TrimSpace(req.EndpointType)
	if manual != "" {
		return []string{manual}
	}
	endpointTypes := common.GetEndpointTypesByChannelType(req.Type, modelName)
	if len(endpointTypes) == 0 {
		endpointTypes = []constant.EndpointType{constant.EndpointTypeOpenAI}
	}
	out := make([]string, 0, len(endpointTypes)+2)
	seen := map[string]bool{}
	for _, endpointType := range endpointTypes {
		value := string(endpointType)
		if value == string(constant.EndpointTypeOpenAIVideo) {
			continue
		}
		if !seen[value] {
			out = append(out, value)
			seen[value] = true
		}
	}
	// 普通 OpenAI 兼容站经常同时支持 chat 与 responses；自动模式下做低成本兜底。
	for _, endpointType := range []constant.EndpointType{constant.EndpointTypeOpenAI, constant.EndpointTypeOpenAIResponse} {
		value := string(endpointType)
		if !seen[value] {
			out = append(out, value)
			seen[value] = true
		}
	}
	return out
}

func channelLabResponseFromTest(modelName string, endpointType string, result testResult, started time.Time) channelLabTestResponse {
	detail := result.detail
	if detail == nil {
		detail = &channelLabTestDetail{Model: modelName, EndpointType: endpointType, DurationMS: time.Since(started).Milliseconds()}
	}
	if detail.DurationMS == 0 {
		detail.DurationMS = time.Since(started).Milliseconds()
	}

	response := channelLabTestResponse{
		Success:      result.localErr == nil && result.newAPIError == nil,
		Model:        modelName,
		EndpointType: endpointType,
		Time:         float64(detail.DurationMS) / 1000.0,
		Detail:       detail,
	}
	if result.localErr != nil {
		response.Message = result.localErr.Error()
	}
	if result.newAPIError != nil {
		response.Message = result.newAPIError.Error()
		detail.ErrorCode = string(result.newAPIError.GetErrorCode())
	}
	if response.Message != "" && detail.ErrorMessage == "" {
		detail.ErrorMessage = response.Message
	}
	if response.Success {
		response.Message = fmt.Sprintf("%s 测试通过", modelName)
	}
	return response
}

func normalizeChannelLabModels(input []string) []string {
	out := make([]string, 0, len(input))
	seen := map[string]bool{}
	for _, item := range input {
		name := strings.TrimSpace(item)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, name)
	}
	return out
}
