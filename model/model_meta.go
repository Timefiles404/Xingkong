package model

import (
	"sort"
	"strconv"
	"strings"
	"unicode"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

const (
	NameRuleExact = iota
	NameRulePrefix
	NameRuleContains
	NameRuleSuffix
	NameRuleFieldMatch
)

type BoundChannel struct {
	Id             int      `json:"id"`
	Name           string   `json:"name"`
	Type           int      `json:"type"`
	UpstreamModels []string `json:"upstream_models,omitempty"`
}

type Model struct {
	Id           int            `json:"id"`
	ModelName    string         `json:"model_name" gorm:"size:128;not null;uniqueIndex:uk_model_name_delete_at,priority:1"`
	Description  string         `json:"description,omitempty" gorm:"type:text"`
	Icon         string         `json:"icon,omitempty" gorm:"type:varchar(128)"`
	Tags         string         `json:"tags,omitempty" gorm:"type:varchar(255)"`
	VendorID     int            `json:"vendor_id,omitempty" gorm:"index"`
	Endpoints    string         `json:"endpoints,omitempty" gorm:"type:text"`
	AdminMeta    string         `json:"admin_meta,omitempty" gorm:"type:text;column:admin_meta"`
	Status       int            `json:"status" gorm:"default:1"`
	SyncOfficial int            `json:"sync_official" gorm:"default:1"`
	CreatedTime  int64          `json:"created_time" gorm:"bigint"`
	UpdatedTime  int64          `json:"updated_time" gorm:"bigint"`
	DeletedAt    gorm.DeletedAt `json:"-" gorm:"index;uniqueIndex:uk_model_name_delete_at,priority:2"`

	BoundChannels []BoundChannel `json:"bound_channels,omitempty" gorm:"-"`
	EnableGroups  []string       `json:"enable_groups,omitempty" gorm:"-"`
	QuotaTypes    []int          `json:"quota_types,omitempty" gorm:"-"`
	NameRule      int            `json:"name_rule" gorm:"default:0"`

	MatchedModels []string `json:"matched_models,omitempty" gorm:"-"`
	MatchedCount  int      `json:"matched_count,omitempty" gorm:"-"`
}

func (mi *Model) Insert() error {
	now := common.GetTimestamp()
	mi.CreatedTime = now
	mi.UpdatedTime = now

	// 保存原始值（因为 Create 后可能被 GORM 的 default 标签覆盖为 1）
	originalStatus := mi.Status
	originalSyncOfficial := mi.SyncOfficial

	// 先创建记录（GORM 会对零值字段应用默认值）
	if err := DB.Create(mi).Error; err != nil {
		return err
	}

	// 使用保存的原始值进行更新，确保零值能正确保存
	return DB.Model(&Model{}).Where("id = ?", mi.Id).Updates(map[string]interface{}{
		"status":        originalStatus,
		"sync_official": originalSyncOfficial,
	}).Error
}

func IsModelNameDuplicated(id int, name string) (bool, error) {
	if name == "" {
		return false, nil
	}
	var cnt int64
	err := DB.Model(&Model{}).Where("model_name = ? AND id <> ?", name, id).Count(&cnt).Error
	return cnt > 0, err
}

func (mi *Model) Update() error {
	mi.UpdatedTime = common.GetTimestamp()
	// 使用 Select 强制更新所有字段，包括零值
	return DB.Model(&Model{}).Where("id = ?", mi.Id).
		Select("model_name", "description", "icon", "tags", "vendor_id", "endpoints", "admin_meta", "status", "sync_official", "name_rule", "updated_time").
		Updates(mi).Error
}

func (mi *Model) Delete() error {
	return DB.Delete(mi).Error
}

func GetVendorModelCounts() (map[int64]int64, error) {
	var stats []struct {
		VendorID int64
		Count    int64
	}
	if err := DB.Model(&Model{}).
		Select("vendor_id as vendor_id, count(*) as count").
		Group("vendor_id").
		Scan(&stats).Error; err != nil {
		return nil, err
	}
	m := make(map[int64]int64, len(stats))
	for _, s := range stats {
		m[s.VendorID] = s.Count
	}
	return m, nil
}

func GetAllModels(offset int, limit int) ([]*Model, error) {
	var models []*Model
	err := DB.Order("id DESC").Offset(offset).Limit(limit).Find(&models).Error
	return models, err
}

func GetBoundChannelsByModelsMap(modelNames []string) (map[string][]BoundChannel, error) {
	result := make(map[string][]BoundChannel)
	if len(modelNames) == 0 {
		return result, nil
	}
	type row struct {
		Id    int
		Model string
		Name  string
		Type  int
	}
	var rows []row
	err := DB.Table("channels").
		Select("channels.id as id, abilities.model as model, channels.name as name, channels.type as type").
		Joins("JOIN abilities ON abilities.channel_id = channels.id").
		Where("abilities.model IN ? AND abilities.enabled = ?", modelNames, true).
		Distinct().
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	channelIDs := make(map[int]struct{})
	for _, r := range rows {
		channelIDs[r.Id] = struct{}{}
		result[r.Model] = append(result[r.Model], BoundChannel{Id: r.Id, Name: r.Name, Type: r.Type})
	}
	if len(channelIDs) == 0 {
		return result, nil
	}
	ids := make([]int, 0, len(channelIDs))
	for id := range channelIDs {
		ids = append(ids, id)
	}
	var channels []Channel
	if err := DB.Select("id", "models").Where("id IN ?", ids).Find(&channels).Error; err == nil {
		rawModelsByChannel := make(map[int][]string, len(channels))
		for _, ch := range channels {
			rawModelsByChannel[ch.Id] = ch.GetModels()
		}
		for modelName, boundChannels := range result {
			for i := range boundChannels {
				boundChannels[i].UpstreamModels = ResolveUpstreamModelsForCanonical(rawModelsByChannel[boundChannels[i].Id], modelName)
			}
			result[modelName] = boundChannels
		}
	}
	return result, nil
}

func SearchModels(keyword string, vendor string, offset int, limit int) ([]*Model, int64, error) {
	var models []*Model
	db := DB.Model(&Model{})
	if keyword != "" {
		like := "%" + keyword + "%"
		db = db.Where("model_name LIKE ? OR description LIKE ? OR tags LIKE ?", like, like, like)
	}
	if vendor != "" {
		if vid, err := strconv.Atoi(vendor); err == nil {
			db = db.Where("models.vendor_id = ?", vid)
		} else {
			db = db.Joins("JOIN vendors ON vendors.id = models.vendor_id").Where("vendors.name LIKE ?", "%"+vendor+"%")
		}
	}
	var total int64
	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := db.Order("models.id DESC").Offset(offset).Limit(limit).Find(&models).Error; err != nil {
		return nil, 0, err
	}
	return models, total, nil
}

type canonicalModelRule struct {
	ModelName string
	NameRule  int
	Status    int
}

type upstreamMatchCandidate struct {
	ModelName string
	Score     int
}

func normalizeModelMatchText(input string) string {
	input = strings.ToLower(strings.TrimSpace(input))
	if input == "" {
		return ""
	}
	var b strings.Builder
	var last rune
	for _, r := range input {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			if b.Len() > 0 && ((unicode.IsDigit(last) && unicode.IsLetter(r)) || (unicode.IsLetter(last) && unicode.IsDigit(r))) {
				b.WriteByte(' ')
			}
			b.WriteRune(r)
			last = r
			continue
		}
		b.WriteByte(' ')
		last = ' '
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

func modelMatchTokens(input string) []string {
	normalized := normalizeModelMatchText(input)
	if normalized == "" {
		return nil
	}
	return strings.Fields(normalized)
}

func allTokensPresent(needle []string, haystack []string) bool {
	if len(needle) == 0 || len(haystack) == 0 {
		return false
	}
	haystackSet := make(map[string]struct{}, len(haystack))
	for _, token := range haystack {
		haystackSet[token] = struct{}{}
	}
	for _, token := range needle {
		if _, ok := haystackSet[token]; !ok {
			return false
		}
	}
	return true
}

func scoreCanonicalUpstreamMatch(canonical string, rule int, upstream string) int {
	canonical = strings.TrimSpace(canonical)
	upstream = strings.TrimSpace(upstream)
	if canonical == "" || upstream == "" {
		return 0
	}
	canonicalNorm := normalizeModelMatchText(canonical)
	upstreamNorm := normalizeModelMatchText(upstream)
	if canonicalNorm == "" || upstreamNorm == "" {
		return 0
	}
	if canonicalNorm == upstreamNorm {
		return 100000 + len(canonicalNorm)
	}

	switch rule {
	case NameRulePrefix:
		if strings.HasPrefix(upstreamNorm, canonicalNorm) {
			return 70000 + len(canonicalNorm)
		}
	case NameRuleSuffix:
		if strings.HasSuffix(upstreamNorm, canonicalNorm) {
			return 70000 + len(canonicalNorm)
		}
	case NameRuleContains:
		if strings.Contains(upstreamNorm, canonicalNorm) {
			return 70000 + len(canonicalNorm)
		}
	case NameRuleFieldMatch:
		// handled below with a higher score than implicit token matching.
	}

	canonicalTokens := modelMatchTokens(canonical)
	upstreamTokens := modelMatchTokens(upstream)
	if allTokensPresent(canonicalTokens, upstreamTokens) {
		base := 50000
		if rule == NameRuleFieldMatch {
			base = 80000
		}
		extraTokens := len(upstreamTokens) - len(canonicalTokens)
		if extraTokens < 0 {
			extraTokens = 0
		}
		return base + len(canonicalTokens)*100 - extraTokens
	}
	return 0
}

func getEnabledCanonicalModelRules() ([]canonicalModelRule, error) {
	var rules []canonicalModelRule
	err := DB.Model(&Model{}).
		Select("model_name", "name_rule", "status").
		Where("status = ?", 1).
		Find(&rules).Error
	return rules, err
}

func bestCanonicalModelForUpstream(upstream string, rules []canonicalModelRule) (string, bool) {
	best := upstreamMatchCandidate{}
	for _, rule := range rules {
		score := scoreCanonicalUpstreamMatch(rule.ModelName, rule.NameRule, upstream)
		if score <= 0 {
			continue
		}
		if score > best.Score || (score == best.Score && len(rule.ModelName) > len(best.ModelName)) {
			best = upstreamMatchCandidate{ModelName: rule.ModelName, Score: score}
		}
	}
	return best.ModelName, best.Score > 0
}

func resolveChannelAbilityModelsWithRules(rawModels []string, rules []canonicalModelRule) []string {
	rawModels = normalizeModelNames(rawModels)
	if len(rawModels) == 0 {
		return nil
	}
	if len(rules) == 0 {
		return rawModels
	}
	seen := make(map[string]struct{})
	resolved := make([]string, 0, len(rawModels))
	for _, rawModel := range rawModels {
		if canonical, ok := bestCanonicalModelForUpstream(rawModel, rules); ok {
			if _, exists := seen[canonical]; exists {
				continue
			}
			seen[canonical] = struct{}{}
			resolved = append(resolved, canonical)
		}
	}
	return resolved
}

func ResolveChannelAbilityModels(rawModels []string) []string {
	rules, err := getEnabledCanonicalModelRules()
	if err != nil {
		common.SysLog("failed to load model clustering rules: " + err.Error())
		return normalizeModelNames(rawModels)
	}
	return resolveChannelAbilityModelsWithRules(rawModels, rules)
}

func ResolveUpstreamModelsForCanonical(rawModels []string, canonical string) []string {
	canonical = strings.TrimSpace(canonical)
	if canonical == "" {
		return nil
	}
	rawModels = normalizeModelNames(rawModels)
	if len(rawModels) == 0 {
		return nil
	}
	var m Model
	rule := NameRuleFieldMatch
	if err := DB.Model(&Model{}).Select("name_rule").Where("model_name = ? AND status = ?", canonical, 1).First(&m).Error; err == nil {
		rule = m.NameRule
	}
	candidates := make([]upstreamMatchCandidate, 0)
	for _, rawModel := range rawModels {
		score := scoreCanonicalUpstreamMatch(canonical, rule, rawModel)
		if score > 0 {
			candidates = append(candidates, upstreamMatchCandidate{ModelName: rawModel, Score: score})
		}
	}
	if len(candidates) == 0 {
		return nil
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].Score == candidates[j].Score {
			return candidates[i].ModelName < candidates[j].ModelName
		}
		return candidates[i].Score > candidates[j].Score
	})
	resolved := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		resolved = append(resolved, candidate.ModelName)
	}
	return resolved
}

func ResolveUpstreamModelForChannel(channel *Channel, canonical string) string {
	if channel == nil {
		return strings.TrimSpace(canonical)
	}
	matches := ResolveUpstreamModelsForCanonical(channel.GetModels(), canonical)
	if len(matches) > 0 {
		return matches[0]
	}
	return strings.TrimSpace(canonical)
}

func normalizeModelNames(input []string) []string {
	seen := make(map[string]struct{}, len(input))
	output := make([]string, 0, len(input))
	for _, item := range input {
		name := strings.TrimSpace(item)
		if name == "" {
			continue
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		output = append(output, name)
	}
	return output
}
