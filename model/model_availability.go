package model

import (
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

type ModelAvailabilityStat struct {
	Success      int64   `json:"success"`
	Total        int64   `json:"total"`
	Availability float64 `json:"availability"`
}

type ModelAvailabilitySummary struct {
	Last10Minutes ModelAvailabilityStat `json:"last_10_minutes"`
	Last30Minutes ModelAvailabilityStat `json:"last_30_minutes"`
	Last1Hour     ModelAvailabilityStat `json:"last_1_hour"`
	Today         ModelAvailabilityStat `json:"today"`
}

type ModelAvailabilityBucket struct {
	StartAt      int64   `json:"start_at"`
	EndAt        int64   `json:"end_at"`
	Success      int64   `json:"success"`
	Total        int64   `json:"total"`
	Availability float64 `json:"availability"`
}

type ModelAvailabilityItem struct {
	ModelName  string                    `json:"model_name"`
	Summary    ModelAvailabilitySummary  `json:"summary"`
	Series     []ModelAvailabilityBucket `json:"series"`
	Successful int64                     `json:"successful"`
	Total      int64                     `json:"total"`
}

type ModelAvailabilityResponse struct {
	View          string                  `json:"view"`
	BucketSeconds int64                   `json:"bucket_seconds"`
	BucketCount   int                     `json:"bucket_count"`
	RangeStart    int64                   `json:"range_start"`
	RangeEnd      int64                   `json:"range_end"`
	GeneratedAt   int64                   `json:"generated_at"`
	Models        []ModelAvailabilityItem `json:"models"`
}

type modelAvailabilityViewConfig struct {
	View          string
	BucketSeconds int64
	BucketCount   int
}

type modelAvailabilityBucketRow struct {
	ModelName   string `gorm:"column:model_name"`
	LogType     int    `gorm:"column:type"`
	BucketStart int64  `gorm:"column:bucket_start"`
	Count       int64  `gorm:"column:count"`
}

type modelAvailabilitySummaryRow struct {
	ModelName    string `gorm:"column:model_name"`
	Success10m   int64  `gorm:"column:success_10m"`
	Total10m     int64  `gorm:"column:total_10m"`
	Success30m   int64  `gorm:"column:success_30m"`
	Total30m     int64  `gorm:"column:total_30m"`
	Success1h    int64  `gorm:"column:success_1h"`
	Total1h      int64  `gorm:"column:total_1h"`
	Success24h   int64  `gorm:"column:success_24h"`
	Total24h     int64  `gorm:"column:total_24h"`
	SuccessToday int64  `gorm:"column:success_today"`
	TotalToday   int64  `gorm:"column:total_today"`
}

type modelAvailabilityCacheEntry struct {
	ExpiresAt int64
	Data      *ModelAvailabilityResponse
}

var modelAvailabilityCache = struct {
	sync.RWMutex
	entries map[string]modelAvailabilityCacheEntry
}{
	entries: make(map[string]modelAvailabilityCacheEntry),
}

const modelAvailabilityCacheTTLSeconds int64 = 45

func resolveModelAvailabilityView(view string) (modelAvailabilityViewConfig, error) {
	switch view {
	case "", "half_hour":
		return modelAvailabilityViewConfig{
			View:          "half_hour",
			BucketSeconds: 30 * 60,
			BucketCount:   48,
		}, nil
	case "minute":
		return modelAvailabilityViewConfig{
			View:          "minute",
			BucketSeconds: 60,
			BucketCount:   60,
		}, nil
	case "hour":
		return modelAvailabilityViewConfig{
			View:          "hour",
			BucketSeconds: 60 * 60,
			BucketCount:   48,
		}, nil
	case "day":
		return modelAvailabilityViewConfig{
			View:          "day",
			BucketSeconds: 24 * 60 * 60,
			BucketCount:   30,
		}, nil
	default:
		return modelAvailabilityViewConfig{}, errors.New("unsupported availability view")
	}
}

func buildAvailabilityStat(success int64, total int64) ModelAvailabilityStat {
	stat := ModelAvailabilityStat{
		Success: success,
		Total:   total,
	}
	if total <= 0 {
		stat.Availability = -1
		return stat
	}
	stat.Availability = float64(success) / float64(total)
	return stat
}

func getLocalDayStartTimestamp(ts int64) int64 {
	current := time.Unix(ts, 0).In(time.Local)
	year, month, day := current.Date()
	return time.Date(year, month, day, 0, 0, 0, 0, current.Location()).Unix()
}

func getModelAvailabilityCache(view string, now int64) *ModelAvailabilityResponse {
	modelAvailabilityCache.RLock()
	entry, ok := modelAvailabilityCache.entries[view]
	modelAvailabilityCache.RUnlock()
	if !ok || entry.ExpiresAt <= now || entry.Data == nil {
		return nil
	}
	return entry.Data
}

func setModelAvailabilityCache(view string, data *ModelAvailabilityResponse, now int64) {
	modelAvailabilityCache.Lock()
	modelAvailabilityCache.entries[view] = modelAvailabilityCacheEntry{
		ExpiresAt: now + modelAvailabilityCacheTTLSeconds,
		Data:      data,
	}
	modelAvailabilityCache.Unlock()
}

func GetModelAvailability(view string, limit int) (*ModelAvailabilityResponse, error) {
	cfg, err := resolveModelAvailabilityView(view)
	if err != nil {
		return nil, err
	}

	now := GetDBTimestamp()
	if cached := getModelAvailabilityCache(cfg.View, now); cached != nil {
		return cached, nil
	}
	currentBucketStart := now - (now % cfg.BucketSeconds)
	rangeStart := currentBucketStart - int64(cfg.BucketCount-1)*cfg.BucketSeconds
	rangeEnd := currentBucketStart + cfg.BucketSeconds

	bucketExpr := fmt.Sprintf("created_at - (created_at %% %d)", cfg.BucketSeconds)
	var bucketRows []modelAvailabilityBucketRow
	err = LOG_DB.Table("logs").
		Select(fmt.Sprintf("model_name, type, %s as bucket_start, count(*) as count", bucketExpr)).
		Where("model_name <> ''").
		Where("type IN ?", []int{LogTypeConsume, LogTypeError}).
		Where("created_at >= ? AND created_at < ?", rangeStart, rangeEnd).
		Group("model_name, type, " + bucketExpr).
		Order("model_name asc, bucket_start asc").
		Scan(&bucketRows).Error
	if err != nil {
		common.SysError("failed to query model availability buckets: " + err.Error())
		return nil, errors.New("查询模型可用性失败")
	}

	last10mStart := now - 10*60
	last30mStart := now - 30*60
	last1hStart := now - 60*60
	last24hStart := now - 24*60*60
	todayStart := getLocalDayStartTimestamp(now)
	summaryQueryStart := last24hStart
	if todayStart < summaryQueryStart {
		summaryQueryStart = todayStart
	}

	var summaryRows []modelAvailabilitySummaryRow
	err = LOG_DB.Table("logs").
		Select(
			`model_name,
			sum(case when type = ? and created_at >= ? then 1 else 0 end) as success_10m,
			sum(case when created_at >= ? then 1 else 0 end) as total_10m,
			sum(case when type = ? and created_at >= ? then 1 else 0 end) as success_30m,
			sum(case when created_at >= ? then 1 else 0 end) as total_30m,
			sum(case when type = ? and created_at >= ? then 1 else 0 end) as success_1h,
			sum(case when created_at >= ? then 1 else 0 end) as total_1h,
			sum(case when type = ? and created_at >= ? then 1 else 0 end) as success_24h,
			sum(case when created_at >= ? then 1 else 0 end) as total_24h,
			sum(case when type = ? and created_at >= ? then 1 else 0 end) as success_today,
			sum(case when created_at >= ? then 1 else 0 end) as total_today`,
			LogTypeConsume, last10mStart,
			last10mStart,
			LogTypeConsume, last30mStart,
			last30mStart,
			LogTypeConsume, last1hStart,
			last1hStart,
			LogTypeConsume, last24hStart,
			last24hStart,
			LogTypeConsume, todayStart,
			todayStart,
		).
		Where("model_name <> ''").
		Where("type IN ?", []int{LogTypeConsume, LogTypeError}).
		Where("created_at >= ? AND created_at <= ?", summaryQueryStart, now).
		Group("model_name").
		Scan(&summaryRows).Error
	if err != nil {
		common.SysError("failed to query model availability summary: " + err.Error())
		return nil, errors.New("查询模型可用性失败")
	}

	modelMap := make(map[string]*ModelAvailabilityItem)
	for _, row := range summaryRows {
		if row.Total24h <= 0 {
			continue
		}
		modelMap[row.ModelName] = &ModelAvailabilityItem{
			ModelName: row.ModelName,
			Summary: ModelAvailabilitySummary{
				Last10Minutes: buildAvailabilityStat(row.Success10m, row.Total10m),
				Last30Minutes: buildAvailabilityStat(row.Success30m, row.Total30m),
				Last1Hour:     buildAvailabilityStat(row.Success1h, row.Total1h),
				Today:         buildAvailabilityStat(row.SuccessToday, row.TotalToday),
			},
		}
	}
	for _, row := range bucketRows {
		if _, ok := modelMap[row.ModelName]; !ok {
			continue
		}
	}

	for _, item := range modelMap {
		item.Series = make([]ModelAvailabilityBucket, cfg.BucketCount)
		for idx := 0; idx < cfg.BucketCount; idx++ {
			startAt := rangeStart + int64(idx)*cfg.BucketSeconds
			item.Series[idx] = ModelAvailabilityBucket{
				StartAt:      startAt,
				EndAt:        startAt + cfg.BucketSeconds,
				Availability: -1,
			}
		}
	}

	for _, row := range bucketRows {
		item := modelMap[row.ModelName]
		idx := int((row.BucketStart - rangeStart) / cfg.BucketSeconds)
		if idx < 0 || idx >= len(item.Series) {
			continue
		}
		if row.LogType == LogTypeConsume {
			item.Series[idx].Success += row.Count
			item.Successful += row.Count
		}
		item.Series[idx].Total += row.Count
		item.Total += row.Count
	}

	models := make([]ModelAvailabilityItem, 0, len(modelMap))
	for _, item := range modelMap {
		for idx := range item.Series {
			item.Series[idx].Availability = buildAvailabilityStat(
				item.Series[idx].Success,
				item.Series[idx].Total,
			).Availability
		}
		if item.Total == 0 &&
			item.Summary.Last10Minutes.Total == 0 &&
			item.Summary.Last30Minutes.Total == 0 &&
			item.Summary.Last1Hour.Total == 0 &&
			item.Summary.Today.Total == 0 {
			continue
		}
		models = append(models, *item)
	}

	sort.Slice(models, func(i int, j int) bool {
		if models[i].Total == models[j].Total {
			return models[i].ModelName < models[j].ModelName
		}
		return models[i].Total > models[j].Total
	})

	if limit > 0 && len(models) > limit {
		models = models[:limit]
	}

	response := &ModelAvailabilityResponse{
		View:          cfg.View,
		BucketSeconds: cfg.BucketSeconds,
		BucketCount:   cfg.BucketCount,
		RangeStart:    rangeStart,
		RangeEnd:      rangeEnd,
		GeneratedAt:   now,
		Models:        models,
	}
	setModelAvailabilityCache(cfg.View, response, now)
	return response, nil
}
