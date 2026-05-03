package model

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	CodexAccountStatusEnabled  = 1
	CodexAccountStatusDisabled = 2
)

type CodexAccount struct {
	Id            int    `json:"id"`
	Name          string `json:"name" gorm:"type:varchar(128);default:''"`
	Email         string `json:"email" gorm:"type:varchar(255);index"`
	AccountID     string `json:"account_id" gorm:"type:varchar(128);uniqueIndex"`
	Credential    string `json:"-" gorm:"type:text;not null"`
	BaseURL       string `json:"base_url" gorm:"type:varchar(512);default:'https://chatgpt.com'"`
	Proxy         string `json:"proxy" gorm:"type:varchar(512);default:''"`
	Status        int    `json:"status" gorm:"default:1"`
	LastRefresh   int64  `json:"last_refresh" gorm:"bigint;default:0"`
	ExpiredAt     int64  `json:"expired_at" gorm:"bigint;default:0"`
	LastUsedTime  int64  `json:"last_used_time" gorm:"bigint;default:0"`
	NextRetryTime int64  `json:"next_retry_time" gorm:"bigint;default:0"`
	UsedCount     int64  `json:"used_count" gorm:"bigint;default:0"`
	FailedCount   int64  `json:"failed_count" gorm:"bigint;default:0"`
	LastError     string `json:"last_error" gorm:"type:text"`
	CreatedAt     int64  `json:"created_at" gorm:"bigint"`
	UpdatedAt     int64  `json:"updated_at" gorm:"bigint"`
}

type CodexAccountPublic struct {
	CodexAccount
	HasRefreshToken bool `json:"has_refresh_token"`
}

type CodexOAuthCredential struct {
	IDToken      string `json:"id_token,omitempty"`
	AccessToken  string `json:"access_token,omitempty"`
	RefreshToken string `json:"refresh_token,omitempty"`

	AccountID   string `json:"account_id,omitempty"`
	LastRefresh string `json:"last_refresh,omitempty"`
	Email       string `json:"email,omitempty"`
	Type        string `json:"type,omitempty"`
	Expired     string `json:"expired,omitempty"`
}

func (a *CodexAccount) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	if a.CreatedAt == 0 {
		a.CreatedAt = now
	}
	if a.UpdatedAt == 0 {
		a.UpdatedAt = now
	}
	if strings.TrimSpace(a.BaseURL) == "" {
		a.BaseURL = "https://chatgpt.com"
	}
	if a.Status == 0 {
		a.Status = CodexAccountStatusEnabled
	}
	return nil
}

func (a *CodexAccount) BeforeUpdate(tx *gorm.DB) error {
	a.UpdatedAt = common.GetTimestamp()
	return nil
}

func (a *CodexAccount) Public() CodexAccountPublic {
	pub := CodexAccountPublic{CodexAccount: *a}
	pub.Credential = ""
	if key, err := ParseCodexOAuthCredential(a.Credential); err == nil {
		pub.HasRefreshToken = strings.TrimSpace(key.RefreshToken) != ""
	}
	return pub
}

func EnsureDefaultCodexPoolChannel() error {
	var channel Channel
	err := DB.Where("type = ? AND "+commonKeyCol+" = ?", constant.ChannelTypeCodex, constant.CodexPoolKeyMarker).First(&channel).Error
	if err == nil {
		updates := map[string]any{}
		if strings.TrimSpace(channel.Name) == "" {
			updates["name"] = "Codex官方渠道"
		}
		if strings.TrimSpace(channel.GetBaseURL()) == "" {
			updates["base_url"] = "https://chatgpt.com"
		}
		if strings.TrimSpace(channel.Group) == "" {
			updates["group"] = "default"
		}
		if len(updates) > 0 {
			return DB.Model(&Channel{}).Where("id = ?", channel.Id).Updates(updates).Error
		}
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}

	baseURL := "https://chatgpt.com"
	autoBan := 0
	priority := int64(0)
	channel = Channel{
		Type:        constant.ChannelTypeCodex,
		Key:         constant.CodexPoolKeyMarker,
		Name:        "Codex官方渠道",
		Status:      common.ChannelStatusEnabled,
		BaseURL:     &baseURL,
		Group:       "default",
		Models:      "gpt-5,gpt-5-codex,gpt-5-codex-mini,gpt-5.1,gpt-5.1-codex,gpt-5.1-codex-max,gpt-5.1-codex-mini,gpt-5.2,gpt-5.2-codex,gpt-5.3-codex,gpt-5.3-codex-spark",
		CreatedTime: common.GetTimestamp(),
		AutoBan:     &autoBan,
		Priority:    &priority,
	}
	return DB.Create(&channel).Error
}

func UpsertCodexAccountFromOAuthKey(key CodexOAuthCredential, name string, baseURL string, proxy string) (*CodexAccount, error) {
	accountID := strings.TrimSpace(key.AccountID)
	if accountID == "" {
		return nil, errors.New("codex account_id is required")
	}
	if strings.TrimSpace(key.AccessToken) == "" {
		return nil, errors.New("codex access_token is required")
	}
	if strings.TrimSpace(key.Type) == "" {
		key.Type = "codex"
	}
	if strings.TrimSpace(baseURL) == "" {
		baseURL = "https://chatgpt.com"
	}
	encoded, err := common.Marshal(key)
	if err != nil {
		return nil, err
	}
	expiredAt := parseCodexRFC3339ToUnix(key.Expired)
	lastRefresh := parseCodexRFC3339ToUnix(key.LastRefresh)
	if lastRefresh == 0 {
		lastRefresh = common.GetTimestamp()
	}
	if strings.TrimSpace(name) == "" {
		name = key.Email
	}
	if strings.TrimSpace(name) == "" {
		name = accountID
	}

	account := CodexAccount{
		Name:        strings.TrimSpace(name),
		Email:       strings.TrimSpace(key.Email),
		AccountID:   accountID,
		Credential:  string(encoded),
		BaseURL:     strings.TrimSpace(baseURL),
		Proxy:       strings.TrimSpace(proxy),
		Status:      CodexAccountStatusEnabled,
		LastRefresh: lastRefresh,
		ExpiredAt:   expiredAt,
		LastError:   "",
	}
	err = DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "account_id"}},
		DoUpdates: clause.Assignments(map[string]any{
			"name":         account.Name,
			"email":        account.Email,
			"credential":   account.Credential,
			"base_url":     account.BaseURL,
			"proxy":        account.Proxy,
			"status":       account.Status,
			"last_refresh": account.LastRefresh,
			"expired_at":   account.ExpiredAt,
			"last_error":   "",
			"updated_at":   common.GetTimestamp(),
		}),
	}).Create(&account).Error
	if err != nil {
		return nil, err
	}
	if err := DB.Where("account_id = ?", accountID).First(&account).Error; err != nil {
		return nil, err
	}
	return &account, nil
}

func SelectCodexAccountForRelay() (*CodexAccount, error) {
	now := common.GetTimestamp()
	var account CodexAccount
	err := DB.Where("status = ? AND (next_retry_time = 0 OR next_retry_time <= ?)", CodexAccountStatusEnabled, now).
		Order("last_used_time asc, id asc").
		First(&account).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("no enabled Codex account available")
		}
		return nil, err
	}
	_ = DB.Model(&CodexAccount{}).Where("id = ?", account.Id).Updates(map[string]any{
		"last_used_time": now,
		"used_count":     gorm.Expr("used_count + ?", 1),
		"updated_at":     now,
	}).Error
	return &account, nil
}

func MarkCodexAccountRelayResult(accountID int, success bool, message string, cooldownSeconds int64) {
	if accountID <= 0 {
		return
	}
	updates := map[string]any{
		"updated_at": common.GetTimestamp(),
	}
	if success {
		updates["last_error"] = ""
		updates["next_retry_time"] = 0
	} else {
		if cooldownSeconds <= 0 {
			cooldownSeconds = 60
		}
		updates["failed_count"] = gorm.Expr("failed_count + ?", 1)
		updates["last_error"] = strings.TrimSpace(message)
		updates["next_retry_time"] = common.GetTimestamp() + cooldownSeconds
	}
	_ = DB.Model(&CodexAccount{}).Where("id = ?", accountID).Updates(updates).Error
}

func parseCodexRFC3339ToUnix(raw string) int64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	t, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return 0
	}
	return t.Unix()
}

func FormatCodexUnixTime(ts int64) string {
	if ts <= 0 {
		return ""
	}
	return time.Unix(ts, 0).Format(time.RFC3339)
}

func GetCodexAccountCredential(id int) (string, error) {
	var account CodexAccount
	if err := DB.Where("id = ?", id).First(&account).Error; err != nil {
		return "", err
	}
	return account.Credential, nil
}

func ParseCodexOAuthCredential(raw string) (*CodexOAuthCredential, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, fmt.Errorf("codex credential is empty")
	}
	var key CodexOAuthCredential
	if err := common.Unmarshal([]byte(strings.TrimSpace(raw)), &key); err != nil {
		return nil, err
	}
	if strings.TrimSpace(key.AccessToken) == "" {
		return nil, fmt.Errorf("codex credential missing access_token")
	}
	if strings.TrimSpace(key.AccountID) == "" {
		return nil, fmt.Errorf("codex credential missing account_id")
	}
	return &key, nil
}
