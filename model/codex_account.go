package model

import (
	"errors"
	"fmt"
	"hash/fnv"
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
	Id             int    `json:"id"`
	OwnerUserID    int    `json:"owner_user_id" gorm:"default:0;index"`
	Name           string `json:"name" gorm:"type:varchar(128);default:''"`
	Email          string `json:"email" gorm:"type:varchar(255);index"`
	AccountID      string `json:"account_id" gorm:"type:varchar(128);uniqueIndex"`
	Credential     string `json:"-" gorm:"type:text;not null"`
	BaseURL        string `json:"base_url" gorm:"type:varchar(512);default:'https://chatgpt.com'"`
	Proxy          string `json:"proxy" gorm:"type:varchar(512);default:''"`
	Priority       int    `json:"priority" gorm:"default:0;index"`
	MaxConcurrency int    `json:"max_concurrency" gorm:"default:1"`
	ActiveRequests int    `json:"active_requests" gorm:"default:0;index"`
	Note           string `json:"note" gorm:"type:text"`
	Status         int    `json:"status" gorm:"default:1"`
	LastRefresh    int64  `json:"last_refresh" gorm:"bigint;default:0"`
	ExpiredAt      int64  `json:"expired_at" gorm:"bigint;default:0"`
	LastUsedTime   int64  `json:"last_used_time" gorm:"bigint;default:0"`
	NextRetryTime  int64  `json:"next_retry_time" gorm:"bigint;default:0"`
	UsedCount      int64  `json:"used_count" gorm:"bigint;default:0"`
	FailedCount    int64  `json:"failed_count" gorm:"bigint;default:0"`
	LastError      string `json:"last_error" gorm:"type:text"`
	CreatedAt      int64  `json:"created_at" gorm:"bigint"`
	UpdatedAt      int64  `json:"updated_at" gorm:"bigint"`
}

type CodexSubagent struct {
	Id          int   `json:"id"`
	UserID      int   `json:"user_id" gorm:"uniqueIndex"`
	AdminUserID int   `json:"admin_user_id" gorm:"default:0;index"`
	CreatedAt   int64 `json:"created_at" gorm:"bigint"`
	UpdatedAt   int64 `json:"updated_at" gorm:"bigint"`
}

type CodexAccountAffinity struct {
	Id           int    `json:"id"`
	OwnerUserID  int    `json:"owner_user_id" gorm:"default:0;index"`
	SessionKey   string `json:"session_key" gorm:"type:varchar(255);uniqueIndex"`
	Model        string `json:"model" gorm:"type:varchar(128);index"`
	AccountRowID int    `json:"account_row_id" gorm:"index"`
	CreatedAt    int64  `json:"created_at" gorm:"bigint"`
	UpdatedAt    int64  `json:"updated_at" gorm:"bigint"`
	LastUsedTime int64  `json:"last_used_time" gorm:"bigint"`
}

type CodexAccountModelState struct {
	Id            int    `json:"id"`
	AccountRowID  int    `json:"account_row_id" gorm:"uniqueIndex:idx_codex_account_model_state"`
	Model         string `json:"model" gorm:"type:varchar(128);uniqueIndex:idx_codex_account_model_state"`
	NextRetryTime int64  `json:"next_retry_time" gorm:"bigint;default:0;index"`
	FailedCount   int64  `json:"failed_count" gorm:"bigint;default:0"`
	LastError     string `json:"last_error" gorm:"type:text"`
	CreatedAt     int64  `json:"created_at" gorm:"bigint"`
	UpdatedAt     int64  `json:"updated_at" gorm:"bigint"`
}

type CodexAccountPublic struct {
	CodexAccount
	HasRefreshToken  bool                     `json:"has_refresh_token"`
	ModelStates      []CodexAccountModelState `json:"model_states,omitempty"`
	OwnerUsername    string                   `json:"owner_username,omitempty"`
	OwnerDisplayName string                   `json:"owner_display_name,omitempty"`
}

type CodexSubagentPublic struct {
	CodexSubagent
	Username           string `json:"username"`
	DisplayName        string `json:"display_name"`
	Email              string `json:"email"`
	AccountCount       int64  `json:"account_count"`
	KeyCount           int64  `json:"key_count"`
	UsedQuota          int64  `json:"used_quota"`
	MarketSoldQuota    int64  `json:"market_sold_quota"`
	MarketSoldKeyCount int64  `json:"market_sold_key_count"`
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

	Priority int    `json:"priority,omitempty"`
	Note     string `json:"note,omitempty"`
	ProxyURL string `json:"proxy_url,omitempty"`
	Disabled *bool  `json:"disabled,omitempty"`
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
	if a.MaxConcurrency <= 0 {
		a.MaxConcurrency = 1
	}
	return nil
}

func (a *CodexAccount) BeforeUpdate(tx *gorm.DB) error {
	a.UpdatedAt = common.GetTimestamp()
	return nil
}

func (s *CodexSubagent) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	if s.CreatedAt == 0 {
		s.CreatedAt = now
	}
	if s.UpdatedAt == 0 {
		s.UpdatedAt = now
	}
	return nil
}

func (s *CodexSubagent) BeforeUpdate(tx *gorm.DB) error {
	s.UpdatedAt = common.GetTimestamp()
	return nil
}

func (a *CodexAccountAffinity) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	if a.CreatedAt == 0 {
		a.CreatedAt = now
	}
	if a.UpdatedAt == 0 {
		a.UpdatedAt = now
	}
	if a.LastUsedTime == 0 {
		a.LastUsedTime = now
	}
	return nil
}

func (a *CodexAccountAffinity) BeforeUpdate(tx *gorm.DB) error {
	a.UpdatedAt = common.GetTimestamp()
	return nil
}

func (s *CodexAccountModelState) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	if s.CreatedAt == 0 {
		s.CreatedAt = now
	}
	if s.UpdatedAt == 0 {
		s.UpdatedAt = now
	}
	return nil
}

func (s *CodexAccountModelState) BeforeUpdate(tx *gorm.DB) error {
	s.UpdatedAt = common.GetTimestamp()
	return nil
}

func (a *CodexAccount) Public() CodexAccountPublic {
	pub := CodexAccountPublic{CodexAccount: *a}
	pub.Credential = ""
	if key, err := ParseCodexOAuthCredential(a.Credential); err == nil {
		pub.HasRefreshToken = strings.TrimSpace(key.RefreshToken) != ""
	}
	_ = DB.Where("account_row_id = ? AND next_retry_time > 0", a.Id).
		Order("next_retry_time desc").
		Find(&pub.ModelStates).Error
	if a.OwnerUserID > 0 {
		var user User
		if err := DB.Select("id", "username", "display_name").Where("id = ?", a.OwnerUserID).First(&user).Error; err == nil {
			pub.OwnerUsername = user.Username
			pub.OwnerDisplayName = user.DisplayName
		}
	}
	return pub
}

func CodexOfficialModelList() []string {
	return []string{
		"gpt-5.5",
		"gpt-5.4",
		"gpt-5.3-codex",
		"gpt-5.3-codex-spark",
	}
}

func GetCodexPoolChannel() (*Channel, error) {
	if err := EnsureDefaultCodexPoolChannel(); err != nil {
		return nil, err
	}
	var channel Channel
	err := DB.Where("type = ? AND "+commonKeyCol+" = ?", constant.ChannelTypeCodex, constant.CodexPoolKeyMarker).First(&channel).Error
	if err != nil {
		return nil, err
	}
	return &channel, nil
}

func ResetCodexAccountActiveRequests() {
	_ = DB.Model(&CodexAccount{}).Where("active_requests <> 0").Update("active_requests", 0).Error
}

func EnsureDefaultCodexPoolChannel() error {
	var channel Channel
	err := DB.Where("type = ? AND "+commonKeyCol+" = ?", constant.ChannelTypeCodex, constant.CodexPoolKeyMarker).First(&channel).Error
	if err == nil {
		updates := map[string]any{}
		models := strings.Join(CodexOfficialModelList(), ",")
		if strings.TrimSpace(channel.Name) == "" {
			updates["name"] = "Codex官方渠道"
		}
		if strings.TrimSpace(channel.GetBaseURL()) == "" {
			updates["base_url"] = "https://chatgpt.com"
		}
		if strings.TrimSpace(channel.Group) == "" {
			updates["group"] = "default"
		}
		if strings.TrimSpace(channel.Models) != models {
			updates["models"] = models
		}
		if channel.Status != common.ChannelStatusEnabled {
			updates["status"] = common.ChannelStatusEnabled
			info := channel.GetOtherInfo()
			delete(info, "status_reason")
			delete(info, "status_time")
			channel.SetOtherInfo(info)
			updates["other_info"] = channel.OtherInfo
		}
		if len(updates) > 0 {
			if err := DB.Model(&Channel{}).Where("id = ?", channel.Id).Updates(updates).Error; err != nil {
				return err
			}
			_ = UpdateAbilityStatus(channel.Id, true)
			InitChannelCache()
			return nil
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
		Models:      strings.Join(CodexOfficialModelList(), ","),
		CreatedTime: common.GetTimestamp(),
		AutoBan:     &autoBan,
		Priority:    &priority,
	}
	return DB.Create(&channel).Error
}

func GetCodexAccountOwnerByAccountID(accountID string) (int, bool) {
	accountID = strings.TrimSpace(accountID)
	if accountID == "" {
		return 0, false
	}
	var account CodexAccount
	if err := DB.Select("owner_user_id").Where("account_id = ?", accountID).First(&account).Error; err != nil {
		return 0, false
	}
	return account.OwnerUserID, true
}

func IsCodexSubagent(userID int) bool {
	if userID <= 0 {
		return false
	}
	var count int64
	_ = DB.Model(&CodexSubagent{}).Where("user_id = ?", userID).Count(&count).Error
	return count > 0
}

func SetCodexSubagent(userID int, adminUserID int) error {
	if userID <= 0 {
		return errors.New("user_id is required")
	}
	var user User
	if err := DB.Where("id = ? AND status = ?", userID, common.UserStatusEnabled).First(&user).Error; err != nil {
		return err
	}
	if user.Role >= common.RoleAdminUser {
		return errors.New("管理员无需设置为 Codex 子代理")
	}
	subagent := CodexSubagent{UserID: userID, AdminUserID: adminUserID}
	return DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "user_id"}},
		DoUpdates: clause.Assignments(map[string]any{
			"admin_user_id": adminUserID,
			"updated_at":    common.GetTimestamp(),
		}),
	}).Create(&subagent).Error
}

func DeleteCodexSubagent(userID int) error {
	if userID <= 0 {
		return errors.New("user_id is required")
	}
	return DB.Delete(&CodexSubagent{}, "user_id = ?", userID).Error
}

func ListCodexSubagents() ([]CodexSubagentPublic, error) {
	var subagents []CodexSubagent
	if err := DB.Order("id desc").Find(&subagents).Error; err != nil {
		return nil, err
	}
	out := make([]CodexSubagentPublic, 0, len(subagents))
	for _, subagent := range subagents {
		item := CodexSubagentPublic{CodexSubagent: subagent}
		var user User
		if err := DB.Select("id", "username", "display_name", "email").Where("id = ?", subagent.UserID).First(&user).Error; err == nil {
			item.Username = user.Username
			item.DisplayName = user.DisplayName
			item.Email = user.Email
		}
		_ = DB.Model(&CodexAccount{}).Where("owner_user_id = ?", subagent.UserID).Count(&item.AccountCount).Error
		_ = DB.Model(&Token{}).Where("codex_subagent_only = ? AND codex_subagent_owner = ?", true, subagent.UserID).Count(&item.KeyCount).Error
		var usedQuota int64
		_ = DB.Model(&Token{}).Where("codex_subagent_only = ? AND codex_subagent_owner = ?", true, subagent.UserID).Select("COALESCE(SUM(used_quota),0)").Scan(&usedQuota).Error
		item.UsedQuota = usedQuota
		var codeSoldQuota int64
		var paymentSoldQuota int64
		var codeSoldCount int64
		var paymentSoldCount int64
		_ = DB.Model(&CodexMarketCode{}).
			Where("seller_id = ? AND status = ? AND token_id > 0", subagent.UserID, CodexMarketCodeRedeemed).
			Count(&codeSoldCount).Error
		_ = DB.Model(&CodexMarketCode{}).
			Where("seller_id = ? AND status = ? AND token_id > 0", subagent.UserID, CodexMarketCodeRedeemed).
			Select("COALESCE(SUM(quota),0)").
			Scan(&codeSoldQuota).Error
		_ = DB.Model(&CodexMarketPayment{}).
			Where("seller_id = ? AND status = ? AND token_id > 0", subagent.UserID, CodexMarketPaymentApproved).
			Count(&paymentSoldCount).Error
		_ = DB.Model(&CodexMarketPayment{}).
			Where("seller_id = ? AND status = ? AND token_id > 0", subagent.UserID, CodexMarketPaymentApproved).
			Select("COALESCE(SUM(quota),0)").
			Scan(&paymentSoldQuota).Error
		item.MarketSoldQuota = codeSoldQuota + paymentSoldQuota
		item.MarketSoldKeyCount = codeSoldCount + paymentSoldCount
		out = append(out, item)
	}
	return out, nil
}

func UpsertCodexAccountFromOAuthKey(key CodexOAuthCredential, name string, baseURL string, proxy string) (*CodexAccount, error) {
	return UpsertCodexAccountFromOAuthKeyForOwner(key, name, baseURL, proxy, 0)
}

func UpsertCodexAccountFromOAuthKeyForOwner(key CodexOAuthCredential, name string, baseURL string, proxy string, ownerUserID int) (*CodexAccount, error) {
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
	if strings.TrimSpace(proxy) == "" && strings.TrimSpace(key.ProxyURL) != "" {
		proxy = key.ProxyURL
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
	status := CodexAccountStatusEnabled
	if key.Disabled != nil && *key.Disabled {
		status = CodexAccountStatusDisabled
	}

	account := CodexAccount{
		OwnerUserID:    ownerUserID,
		Name:           strings.TrimSpace(name),
		Email:          strings.TrimSpace(key.Email),
		AccountID:      accountID,
		Credential:     string(encoded),
		BaseURL:        strings.TrimSpace(baseURL),
		Proxy:          strings.TrimSpace(proxy),
		Priority:       key.Priority,
		MaxConcurrency: 1,
		Note:           strings.TrimSpace(key.Note),
		Status:         status,
		LastRefresh:    lastRefresh,
		ExpiredAt:      expiredAt,
		LastError:      "",
	}
	err = DB.Transaction(func(tx *gorm.DB) error {
		var existing CodexAccount
		err := tx.Where("account_id = ?", accountID).First(&existing).Error
		if err == nil {
			if existing.OwnerUserID != ownerUserID {
				return fmt.Errorf("codex account already belongs to owner_user_id=%d", existing.OwnerUserID)
			}
			return tx.Model(&CodexAccount{}).Where("id = ?", existing.Id).Updates(map[string]any{
				"name":            account.Name,
				"email":           account.Email,
				"credential":      account.Credential,
				"base_url":        account.BaseURL,
				"proxy":           account.Proxy,
				"priority":        account.Priority,
				"max_concurrency": gorm.Expr("CASE WHEN max_concurrency <= 0 THEN 1 ELSE max_concurrency END"),
				"note":            account.Note,
				"status":          account.Status,
				"last_refresh":    account.LastRefresh,
				"expired_at":      account.ExpiredAt,
				"last_error":      "",
				"updated_at":      common.GetTimestamp(),
			}).Error
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		return tx.Create(&account).Error
	})
	if err != nil {
		return nil, err
	}
	if err := DB.Where("account_id = ? AND owner_user_id = ?", accountID, ownerUserID).First(&account).Error; err != nil {
		return nil, err
	}
	return &account, nil
}

func normalizeCodexAffinityKey(ownerUserID int, sessionKey string, model string) string {
	sessionKey = strings.TrimSpace(sessionKey)
	if sessionKey == "" {
		return ""
	}
	model = strings.TrimSpace(model)
	if model == "" {
		model = "default"
	}
	key := fmt.Sprintf("codex::owner:%d::%s::%s", ownerUserID, model, sessionKey)
	if len(key) <= 240 {
		return key
	}
	h := fnv.New64a()
	_, _ = h.Write([]byte(key))
	return fmt.Sprintf("codex::%s::hash:%016x", truncateCodexAffinityPart(model, 80), h.Sum64())
}

func truncateCodexAffinityPart(s string, limit int) string {
	s = strings.TrimSpace(s)
	if limit <= 0 || len(s) <= limit {
		return s
	}
	return s[:limit]
}

func touchSelectedCodexAccount(tx *gorm.DB, account *CodexAccount, now int64) error {
	if account == nil || account.Id <= 0 {
		return nil
	}
	return tx.Model(&CodexAccount{}).Where("id = ?", account.Id).Updates(map[string]any{
		"last_used_time":  now,
		"used_count":      gorm.Expr("used_count + ?", 1),
		"active_requests": gorm.Expr("active_requests + ?", 1),
		"updated_at":      now,
	}).Error
}

func ReleaseCodexAccountRequest(accountID int) {
	if accountID <= 0 {
		return
	}
	_ = DB.Model(&CodexAccount{}).Where("id = ?", accountID).Updates(map[string]any{
		"active_requests": gorm.Expr("CASE WHEN active_requests > 0 THEN active_requests - 1 ELSE 0 END"),
		"updated_at":      common.GetTimestamp(),
	}).Error
}

func bindCodexAccountAffinity(tx *gorm.DB, ownerUserID int, sessionKey string, modelName string, accountID int, now int64) error {
	sessionKey = normalizeCodexAffinityKey(ownerUserID, sessionKey, modelName)
	if sessionKey == "" || accountID <= 0 {
		return nil
	}
	affinity := CodexAccountAffinity{
		OwnerUserID:  ownerUserID,
		SessionKey:   sessionKey,
		Model:        truncateCodexAffinityPart(modelName, 128),
		AccountRowID: accountID,
		LastUsedTime: now,
	}
	return tx.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "session_key"}},
		DoUpdates: clause.Assignments(map[string]any{
			"model":          affinity.Model,
			"account_row_id": accountID,
			"last_used_time": now,
			"updated_at":     now,
		}),
	}).Create(&affinity).Error
}

func selectAvailableCodexAccount(tx *gorm.DB, now int64) (*CodexAccount, error) {
	return selectAvailableCodexAccountForModel(tx, now, "", 0)
}

func selectAvailableCodexAccountForModel(tx *gorm.DB, now int64, modelName string, ownerUserID int) (*CodexAccount, error) {
	var account CodexAccount
	q := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("owner_user_id = ? AND status = ? AND (next_retry_time = 0 OR next_retry_time <= ?)", ownerUserID, CodexAccountStatusEnabled, now).
		Where("active_requests < CASE WHEN max_concurrency <= 0 THEN 1 ELSE max_concurrency END").
		Order("priority desc, last_used_time asc, id asc")
	modelName = truncateCodexAffinityPart(modelName, 128)
	if modelName != "" {
		q = q.Where("NOT EXISTS (SELECT 1 FROM codex_account_model_states s WHERE s.account_row_id = codex_accounts.id AND s.model = ? AND s.next_retry_time > ?)", modelName, now)
	}
	err := q.First(&account).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("no enabled Codex account available")
		}
		return nil, err
	}
	return &account, nil
}

func SelectCodexAccountForRelay(sessionKey string, modelName string) (*CodexAccount, error) {
	return SelectCodexAccountForRelayWithOwner(sessionKey, modelName, 0)
}

func SelectCodexAccountForRelayWithOwner(sessionKey string, modelName string, ownerUserID int) (*CodexAccount, error) {
	now := common.GetTimestamp()
	var selected *CodexAccount
	err := DB.Transaction(func(tx *gorm.DB) error {
		affinityKey := normalizeCodexAffinityKey(ownerUserID, sessionKey, modelName)
		if affinityKey != "" {
			var affinity CodexAccountAffinity
			err := tx.Where("session_key = ?", affinityKey).First(&affinity).Error
			if err == nil && affinity.AccountRowID > 0 {
				var account CodexAccount
				q := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
					Where("id = ? AND owner_user_id = ? AND status = ? AND (next_retry_time = 0 OR next_retry_time <= ?)", affinity.AccountRowID, ownerUserID, CodexAccountStatusEnabled, now).
					Where("active_requests < CASE WHEN max_concurrency <= 0 THEN 1 ELSE max_concurrency END").
					Limit(1)
				modelKey := truncateCodexAffinityPart(modelName, 128)
				if modelKey != "" {
					q = q.Where("NOT EXISTS (SELECT 1 FROM codex_account_model_states s WHERE s.account_row_id = codex_accounts.id AND s.model = ? AND s.next_retry_time > ?)", modelKey, now)
				}
				err = q.First(&account).Error
				if err == nil {
					if err = touchSelectedCodexAccount(tx, &account, now); err != nil {
						return err
					}
					_ = tx.Model(&CodexAccountAffinity{}).Where("id = ?", affinity.Id).Updates(map[string]any{
						"last_used_time": now,
						"updated_at":     now,
					}).Error
					selected = &account
					return nil
				}
			} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
		}

		account, err := selectAvailableCodexAccountForModel(tx, now, modelName, ownerUserID)
		if err != nil {
			return err
		}
		if err = touchSelectedCodexAccount(tx, account, now); err != nil {
			return err
		}
		if err = bindCodexAccountAffinity(tx, ownerUserID, sessionKey, modelName, account.Id, now); err != nil {
			return err
		}
		selected = account
		return nil
	})
	if err != nil {
		return nil, err
	}
	return selected, nil
}

func MarkCodexAccountRelayResult(accountID int, success bool, message string, cooldownSeconds int64) {
	MarkCodexAccountModelRelayResult(accountID, "", success, message, cooldownSeconds, true)
}

func MarkCodexAccountModelRelayResult(accountID int, modelName string, success bool, message string, cooldownSeconds int64, accountWide bool) {
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
	if accountWide {
		_ = DB.Model(&CodexAccount{}).Where("id = ?", accountID).Updates(updates).Error
		if !success {
			_ = DB.Where("account_row_id = ?", accountID).Delete(&CodexAccountAffinity{}).Error
		}
		return
	}

	modelName = truncateCodexAffinityPart(modelName, 128)
	if modelName == "" {
		return
	}
	if success {
		_ = DB.Model(&CodexAccountModelState{}).
			Where("account_row_id = ? AND model = ?", accountID, modelName).
			Updates(map[string]any{
				"next_retry_time": 0,
				"last_error":      "",
				"updated_at":      common.GetTimestamp(),
			}).Error
		return
	}
	state := CodexAccountModelState{
		AccountRowID:  accountID,
		Model:         modelName,
		NextRetryTime: common.GetTimestamp() + cooldownSeconds,
		FailedCount:   1,
		LastError:     strings.TrimSpace(message),
	}
	_ = DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "account_row_id"}, {Name: "model"}},
		DoUpdates: clause.Assignments(map[string]any{
			"next_retry_time": state.NextRetryTime,
			"failed_count":    gorm.Expr("failed_count + ?", 1),
			"last_error":      state.LastError,
			"updated_at":      common.GetTimestamp(),
		}),
	}).Create(&state).Error
	_ = DB.Where("account_row_id = ? AND model = ?", accountID, modelName).Delete(&CodexAccountAffinity{}).Error
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
