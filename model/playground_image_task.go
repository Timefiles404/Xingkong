package model

import (
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	PlaygroundImageTaskStatusQueued    = "queued"
	PlaygroundImageTaskStatusRunning   = "running"
	PlaygroundImageTaskStatusSucceeded = "succeeded"
	PlaygroundImageTaskStatusFailed    = "failed"
)

type PlaygroundImageTask struct {
	ID          string `json:"id" gorm:"primaryKey;type:varchar(64)"`
	UserId      int    `json:"user_id" gorm:"index"`
	RelayPath   string `json:"relay_path" gorm:"type:varchar(64);not null"`
	Method      string `json:"method" gorm:"type:varchar(16);not null;default:'POST'"`
	ContentType string `json:"content_type" gorm:"type:varchar(255)"`
	RequestBody []byte `json:"-" gorm:"column:request_body"`

	Status       string `json:"status" gorm:"type:varchar(24);index"`
	StatusCode   int    `json:"status_code" gorm:"default:0"`
	ResponseBody []byte `json:"-" gorm:"column:response_body"`
	ErrorMessage string `json:"error_message" gorm:"type:text"`

	CreatedAt   int64 `json:"created_at" gorm:"bigint;index"`
	UpdatedAt   int64 `json:"updated_at" gorm:"bigint"`
	CompletedAt int64 `json:"completed_at" gorm:"bigint;default:0"`
}

func (t *PlaygroundImageTask) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	t.CreatedAt = now
	t.UpdatedAt = now
	if t.Status == "" {
		t.Status = PlaygroundImageTaskStatusQueued
	}
	if t.Method == "" {
		t.Method = "POST"
	}
	return nil
}

func (t *PlaygroundImageTask) BeforeUpdate(tx *gorm.DB) error {
	t.UpdatedAt = common.GetTimestamp()
	return nil
}

func CreatePlaygroundImageTask(task *PlaygroundImageTask) error {
	return DB.Create(task).Error
}

func GetPlaygroundImageTask(taskID string, userID int) (*PlaygroundImageTask, error) {
	var task PlaygroundImageTask
	err := DB.Where("id = ? AND user_id = ?", taskID, userID).First(&task).Error
	if err != nil {
		return nil, err
	}
	return &task, nil
}

func GetPlaygroundImageTaskByID(taskID string) (*PlaygroundImageTask, error) {
	var task PlaygroundImageTask
	err := DB.Where("id = ?", taskID).First(&task).Error
	if err != nil {
		return nil, err
	}
	return &task, nil
}

func MarkPlaygroundImageTaskRunning(taskID string) error {
	return DB.Model(&PlaygroundImageTask{}).
		Where("id = ? AND status IN ?", taskID, []string{PlaygroundImageTaskStatusQueued, PlaygroundImageTaskStatusRunning}).
		Updates(map[string]any{
			"status":     PlaygroundImageTaskStatusRunning,
			"updated_at": common.GetTimestamp(),
		}).Error
}

func CompletePlaygroundImageTask(taskID string, statusCode int, responseBody []byte) error {
	return DB.Model(&PlaygroundImageTask{}).
		Where("id = ?", taskID).
		Updates(map[string]any{
			"status":        PlaygroundImageTaskStatusSucceeded,
			"status_code":   statusCode,
			"response_body": responseBody,
			"error_message": "",
			"completed_at":  common.GetTimestamp(),
			"updated_at":    common.GetTimestamp(),
		}).Error
}

func FailPlaygroundImageTask(taskID string, statusCode int, errorMessage string, responseBody []byte) error {
	return DB.Model(&PlaygroundImageTask{}).
		Where("id = ?", taskID).
		Updates(map[string]any{
			"status":        PlaygroundImageTaskStatusFailed,
			"status_code":   statusCode,
			"response_body": responseBody,
			"error_message": errorMessage,
			"completed_at":  common.GetTimestamp(),
			"updated_at":    common.GetTimestamp(),
		}).Error
}

func FailStalePlaygroundImageTasks(maxAge time.Duration) error {
	cutoff := common.GetTimestamp() - int64(maxAge.Seconds())
	return DB.Model(&PlaygroundImageTask{}).
		Where("status IN ? AND created_at < ?", []string{PlaygroundImageTaskStatusQueued, PlaygroundImageTaskStatusRunning}, cutoff).
		Updates(map[string]any{
			"status":        PlaygroundImageTaskStatusFailed,
			"error_message": "任务超时，请重新生成",
			"completed_at":  common.GetTimestamp(),
			"updated_at":    common.GetTimestamp(),
		}).Error
}
