package controller

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type codexAccountOAuthCompleteRequest struct {
	Input       string `json:"input"`
	Name        string `json:"name"`
	BaseURL     string `json:"base_url"`
	Proxy       string `json:"proxy"`
	OwnerUserID *int   `json:"owner_user_id"`
}

type codexAccountImportRequest struct {
	Raw         string `json:"raw"`
	BaseURL     string `json:"base_url"`
	Proxy       string `json:"proxy"`
	OwnerUserID *int   `json:"owner_user_id"`
}

type codexAccountUpdateRequest struct {
	Name     *string `json:"name"`
	BaseURL  *string `json:"base_url"`
	Proxy    *string `json:"proxy"`
	Priority *int    `json:"priority"`
	Note     *string `json:"note"`
	Status   *int    `json:"status"`
}

type codexSubagentRequest struct {
	UserID int `json:"user_id"`
}

type codexProxyKeyRequest struct {
	Name           string `json:"name"`
	RemainQuota    int    `json:"remain_quota"`
	UnlimitedQuota bool   `json:"unlimited_quota"`
	ExpiredTime    int64  `json:"expired_time"`
	Status         int    `json:"status"`
	OwnerUserID    int    `json:"owner_user_id"`
}

func codexAccountOAuthSessionKey(field string) string {
	return fmt.Sprintf("codex_account_oauth_%s", field)
}

func codexAccountScope(c *gin.Context) (ownerUserID int, isAdmin bool, ok bool) {
	role := c.GetInt("role")
	userID := c.GetInt("id")
	isAdmin = role >= common.RoleAdminUser
	if isAdmin {
		return 0, true, true
	}
	if model.IsCodexSubagent(userID) {
		return userID, false, true
	}
	c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "没有 Codex 子代理权限"})
	return 0, false, false
}

func codexOwnerFromRequest(c *gin.Context, requested int, isAdmin bool, fallback int) int {
	if !isAdmin {
		return fallback
	}
	if requested > 0 {
		return requested
	}
	queryOwner, _ := strconv.Atoi(c.Query("owner_user_id"))
	if queryOwner > 0 {
		return queryOwner
	}
	return 0
}

func codexOwnerForAccountMutation(c *gin.Context, requested *int, accountID string, isAdmin bool, fallback int) int {
	if !isAdmin {
		return fallback
	}
	if requested != nil {
		return *requested
	}
	queryOwner, _ := strconv.Atoi(c.Query("owner_user_id"))
	if queryOwner > 0 {
		return queryOwner
	}
	if existingOwner, ok := model.GetCodexAccountOwnerByAccountID(accountID); ok {
		return existingOwner
	}
	return 0
}

func ensureCodexAccountAccess(c *gin.Context, accountID int) (*model.CodexAccount, bool) {
	ownerUserID, isAdmin, ok := codexAccountScope(c)
	if !ok {
		return nil, false
	}
	var account model.CodexAccount
	if err := model.DB.Where("id = ?", accountID).First(&account).Error; err != nil {
		common.ApiError(c, err)
		return nil, false
	}
	if !isAdmin && account.OwnerUserID != ownerUserID {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "只能管理自己的 Codex 账号"})
		return nil, false
	}
	return &account, true
}

func GetCodexAccountAccess(c *gin.Context) {
	isAdmin := c.GetInt("role") >= common.RoleAdminUser
	isSubagent := model.IsCodexSubagent(c.GetInt("id"))
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"is_admin":    isAdmin,
			"is_subagent": isSubagent,
			"user_id":     c.GetInt("id"),
		},
	})
}

func GetCodexAccounts(c *gin.Context) {
	ownerUserID, isAdmin, ok := codexAccountScope(c)
	if !ok {
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 200 {
		pageSize = 20
	}
	search := strings.TrimSpace(c.Query("search"))
	tx := model.DB.Model(&model.CodexAccount{})
	if isAdmin {
		if rawOwner, exists := c.GetQuery("owner_user_id"); exists {
			queryOwner, _ := strconv.Atoi(rawOwner)
			tx = tx.Where("owner_user_id = ?", queryOwner)
		}
	} else {
		tx = tx.Where("owner_user_id = ?", ownerUserID)
	}
	if search != "" {
		like := "%" + search + "%"
		tx = tx.Where("name LIKE ? OR email LIKE ? OR account_id LIKE ?", like, like, like)
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	var accounts []model.CodexAccount
	if err := tx.Order("id desc").Limit(pageSize).Offset((page - 1) * pageSize).Find(&accounts).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]model.CodexAccountPublic, 0, len(accounts))
	for i := range accounts {
		items = append(items, accounts[i].Public())
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"items": items, "total": total, "page": page, "page_size": pageSize}})
}

func StartCodexAccountOAuth(c *gin.Context) {
	flow, err := service.CreateCodexOAuthAuthorizationFlow()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	session := sessions.Default(c)
	session.Set(codexAccountOAuthSessionKey("state"), flow.State)
	session.Set(codexAccountOAuthSessionKey("verifier"), flow.Verifier)
	session.Set(codexAccountOAuthSessionKey("created_at"), time.Now().Unix())
	_ = session.Save()
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"authorize_url": flow.AuthorizeURL}})
}

func CompleteCodexAccountOAuth(c *gin.Context) {
	req := codexAccountOAuthCompleteRequest{}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	code, state, err := parseCodexAuthorizationInput(req.Input)
	if err != nil || strings.TrimSpace(code) == "" || strings.TrimSpace(state) == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "授权回调格式无效"})
		return
	}
	session := sessions.Default(c)
	expectedState, _ := session.Get(codexAccountOAuthSessionKey("state")).(string)
	verifier, _ := session.Get(codexAccountOAuthSessionKey("verifier")).(string)
	if strings.TrimSpace(expectedState) == "" || strings.TrimSpace(verifier) == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "OAuth 会话已过期，请重新开始"})
		return
	}
	if state != expectedState {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "state mismatch"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()
	tokenRes, err := service.ExchangeCodexAuthorizationCodeWithProxy(ctx, code, verifier, req.Proxy)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "授权码交换失败：" + err.Error()})
		return
	}
	credential, err := service.BuildCodexCredentialFromTokenResult(tokenRes)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	ownerUserID, isAdmin, ok := codexAccountScope(c)
	if !ok {
		return
	}
	ownerUserID = codexOwnerForAccountMutation(c, req.OwnerUserID, credential.AccountID, isAdmin, ownerUserID)
	account, err := model.UpsertCodexAccountFromOAuthKeyForOwner(*credential, req.Name, req.BaseURL, req.Proxy, ownerUserID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	session.Delete(codexAccountOAuthSessionKey("state"))
	session.Delete(codexAccountOAuthSessionKey("verifier"))
	session.Delete(codexAccountOAuthSessionKey("created_at"))
	_ = session.Save()
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "saved", "data": account.Public()})
}

func ImportCodexAccounts(c *gin.Context) {
	ownerUserID, isAdmin, ok := codexAccountScope(c)
	if !ok {
		return
	}
	req := codexAccountImportRequest{}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	credentials, err := service.ExtractCodexCredentialObjects(req.Raw)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	imported := 0
	failures := make([]string, 0)
	for _, credential := range credentials {
		targetOwnerID := codexOwnerForAccountMutation(c, req.OwnerUserID, credential.AccountID, isAdmin, ownerUserID)
		if _, err := model.UpsertCodexAccountFromOAuthKeyForOwner(credential, "", req.BaseURL, req.Proxy, targetOwnerID); err == nil {
			imported++
		} else {
			failures = append(failures, fmt.Sprintf("%s: %s", credential.AccountID, err.Error()))
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"success": len(failures) == 0,
		"message": strings.Join(failures, "\n"),
		"data":    gin.H{"imported": imported, "total": len(credentials), "failures": failures},
	})
}

func ExportCodexAccounts(c *gin.Context) {
	ownerUserID, isAdmin, ok := codexAccountScope(c)
	if !ok {
		return
	}
	var accounts []model.CodexAccount
	tx := model.DB.Order("id asc")
	if isAdmin {
		if rawOwner, exists := c.GetQuery("owner_user_id"); exists {
			queryOwner, _ := strconv.Atoi(rawOwner)
			tx = tx.Where("owner_user_id = ?", queryOwner)
		}
	} else {
		tx = tx.Where("owner_user_id = ?", ownerUserID)
	}
	if err := tx.Find(&accounts).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	out := make([]json.RawMessage, 0, len(accounts))
	for _, account := range accounts {
		raw := strings.TrimSpace(account.Credential)
		if raw != "" {
			if credential, err := model.ParseCodexOAuthCredential(raw); err == nil {
				credential.Priority = account.Priority
				credential.Note = account.Note
				credential.ProxyURL = account.Proxy
				disabled := account.Status == model.CodexAccountStatusDisabled
				credential.Disabled = &disabled
				if encoded, err := common.Marshal(credential); err == nil {
					raw = string(encoded)
				}
			}
			out = append(out, json.RawMessage(raw))
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": out})
}

func UpdateCodexAccount(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if _, ok := ensureCodexAccountAccess(c, id); !ok {
		return
	}
	req := codexAccountUpdateRequest{}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	updates := map[string]any{}
	if req.Name != nil {
		updates["name"] = strings.TrimSpace(*req.Name)
	}
	if req.BaseURL != nil {
		baseURL := strings.TrimSpace(*req.BaseURL)
		if baseURL == "" {
			baseURL = "https://chatgpt.com"
		}
		updates["base_url"] = baseURL
	}
	if req.Proxy != nil {
		updates["proxy"] = strings.TrimSpace(*req.Proxy)
	}
	if req.Priority != nil {
		updates["priority"] = *req.Priority
	}
	if req.Note != nil {
		updates["note"] = strings.TrimSpace(*req.Note)
	}
	if req.Status != nil {
		if *req.Status != model.CodexAccountStatusEnabled && *req.Status != model.CodexAccountStatusDisabled {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid status"})
			return
		}
		updates["status"] = *req.Status
	}
	if len(updates) == 0 {
		c.JSON(http.StatusOK, gin.H{"success": true})
		return
	}
	if err := model.DB.Model(&model.CodexAccount{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func DeleteCodexAccount(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if _, ok := ensureCodexAccountAccess(c, id); !ok {
		return
	}
	if err := model.DB.Delete(&model.CodexAccount{}, id).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func RefreshCodexAccount(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if _, ok := ensureCodexAccountAccess(c, id); !ok {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()
	account, err := service.RefreshCodexAccountCredential(ctx, id)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": account.Public()})
}

func GetCodexAccountUsage(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if _, ok := ensureCodexAccountAccess(c, id); !ok {
		return
	}
	var account model.CodexAccount
	if err := model.DB.Where("id = ?", id).First(&account).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "account not found"})
			return
		}
		common.ApiError(c, err)
		return
	}
	key, err := model.ParseCodexOAuthCredential(account.Credential)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	client, err := service.GetHttpClientWithProxy(account.Proxy)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if client == nil {
		client = http.DefaultClient
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()
	baseURL := account.BaseURL
	if strings.TrimSpace(baseURL) == "" {
		baseURL = "https://chatgpt.com"
	}
	status, body, err := service.FetchCodexWhamUsage(ctx, client, baseURL, key.AccessToken, key.AccountID)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	var data any
	if err := json.Unmarshal(body, &data); err != nil {
		data = string(body)
	}
	c.JSON(http.StatusOK, gin.H{"success": status >= 200 && status < 300, "upstream_status": status, "data": data})
}

func ListCodexSubagents(c *gin.Context) {
	items, err := model.ListCodexSubagents()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": items})
}

func AddCodexSubagent(c *gin.Context) {
	req := codexSubagentRequest{}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.SetCodexSubagent(req.UserID, c.GetInt("id")); err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func DeleteCodexSubagent(c *gin.Context) {
	userID, err := strconv.Atoi(c.Param("user_id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.DeleteCodexSubagent(userID); err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func ListCodexProxyKeys(c *gin.Context) {
	ownerUserID, isAdmin, ok := codexAccountScope(c)
	if !ok {
		return
	}
	ownerUserID = codexOwnerFromRequest(c, 0, isAdmin, ownerUserID)
	hasOwnerFilter := false
	if isAdmin {
		_, hasOwnerFilter = c.GetQuery("owner_user_id")
	}
	if ownerUserID <= 0 && !isAdmin {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "没有 Codex 子代理权限"})
		return
	}
	tx := model.DB.Where("codex_subagent_only = ?", true)
	if ownerUserID > 0 || hasOwnerFilter {
		tx = tx.Where("codex_subagent_owner = ?", ownerUserID)
	}
	var tokens []model.Token
	if err := tx.Order("id desc").Find(&tokens).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]*model.Token, 0, len(tokens))
	for i := range tokens {
		token := tokens[i]
		items = append(items, buildMaskedTokenResponse(&token))
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": items})
}

func CreateCodexProxyKey(c *gin.Context) {
	ownerUserID, isAdmin, ok := codexAccountScope(c)
	if !ok {
		return
	}
	req := codexProxyKeyRequest{}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	ownerUserID = codexOwnerFromRequest(c, req.OwnerUserID, isAdmin, ownerUserID)
	if ownerUserID <= 0 {
		if isAdmin {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "管理员需要先选择一个子代理后再生成分发密钥"})
			return
		}
		ownerUserID = c.GetInt("id")
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = "Codex 托管密钥"
	}
	if req.RemainQuota < 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "额度不能为负数"})
		return
	}
	key, err := common.GenerateKey()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	token := model.Token{
		UserId:             ownerUserID,
		Name:               name,
		Key:                key,
		Status:             common.TokenStatusEnabled,
		CreatedTime:        common.GetTimestamp(),
		AccessedTime:       common.GetTimestamp(),
		ExpiredTime:        req.ExpiredTime,
		RemainQuota:        req.RemainQuota,
		UnlimitedQuota:     req.UnlimitedQuota,
		ModelLimitsEnabled: true,
		ModelLimits:        strings.Join(model.CodexOfficialModelList(), ","),
		Group:              "default",
		CodexSubagentOnly:  true,
		CodexSubagentOwner: ownerUserID,
	}
	if token.ExpiredTime == 0 {
		token.ExpiredTime = -1
	}
	if err := token.Insert(); err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"key": "sk-" + key, "token": buildMaskedTokenResponse(&token)}})
}

func UpdateCodexProxyKey(c *gin.Context) {
	ownerUserID, isAdmin, ok := codexAccountScope(c)
	if !ok {
		return
	}
	ownerUserID = codexOwnerFromRequest(c, 0, isAdmin, ownerUserID)
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var token model.Token
	tx := model.DB.Where("id = ? AND codex_subagent_only = ?", id, true)
	if ownerUserID > 0 {
		tx = tx.Where("codex_subagent_owner = ?", ownerUserID)
	}
	if err := tx.First(&token).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	if isCodexMarketplaceToken(token.Id) {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "市场兑换 Key 不能在分发密钥里修改"})
		return
	}
	req := codexProxyKeyRequest{}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if strings.TrimSpace(req.Name) != "" {
		token.Name = strings.TrimSpace(req.Name)
	}
	if req.RemainQuota >= 0 {
		token.RemainQuota = req.RemainQuota
	}
	if req.ExpiredTime != 0 {
		token.ExpiredTime = req.ExpiredTime
	}
	if req.Status != 0 {
		token.Status = req.Status
	}
	token.UnlimitedQuota = req.UnlimitedQuota
	token.ModelLimitsEnabled = true
	token.ModelLimits = strings.Join(model.CodexOfficialModelList(), ",")
	token.Group = "default"
	token.CodexSubagentOnly = true
	token.CodexSubagentOwner = token.UserId
	if err := token.Update(); err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func DeleteCodexProxyKey(c *gin.Context) {
	ownerUserID, isAdmin, ok := codexAccountScope(c)
	if !ok {
		return
	}
	ownerUserID = codexOwnerFromRequest(c, 0, isAdmin, ownerUserID)
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var token model.Token
	tx := model.DB.Where("id = ? AND codex_subagent_only = ?", id, true)
	if ownerUserID > 0 {
		tx = tx.Where("codex_subagent_owner = ?", ownerUserID)
	}
	if err := tx.First(&token).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	if isCodexMarketplaceToken(token.Id) {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "市场兑换 Key 不能由卖家删除"})
		return
	}
	if err := token.Delete(); err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func GetCodexProxyKeySecret(c *gin.Context) {
	ownerUserID, isAdmin, ok := codexAccountScope(c)
	if !ok {
		return
	}
	ownerUserID = codexOwnerFromRequest(c, 0, isAdmin, ownerUserID)
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var token model.Token
	tx := model.DB.Where("id = ? AND codex_subagent_only = ?", id, true)
	if ownerUserID > 0 {
		tx = tx.Where("codex_subagent_owner = ?", ownerUserID)
	}
	if err := tx.First(&token).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	if isCodexMarketplaceToken(token.Id) {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "卖家不能查看市场兑换 Key 的完整内容"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"key": "sk-" + token.Key}})
}

func isCodexMarketplaceToken(tokenID int) bool {
	if tokenID <= 0 {
		return false
	}
	var count int64
	_ = model.DB.Model(&model.CodexMarketCode{}).Where("token_id = ?", tokenID).Count(&count).Error
	return count > 0
}

func GetCodexProxyStats(c *gin.Context) {
	ownerUserID, isAdmin, ok := codexAccountScope(c)
	if !ok {
		return
	}
	ownerUserID = codexOwnerFromRequest(c, 0, isAdmin, ownerUserID)
	hasOwnerFilter := false
	if isAdmin {
		_, hasOwnerFilter = c.GetQuery("owner_user_id")
	}
	if ownerUserID <= 0 && !isAdmin {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "没有 Codex 子代理权限"})
		return
	}
	var tokens []model.Token
	tx := model.DB.Where("codex_subagent_only = ?", true)
	if ownerUserID > 0 || hasOwnerFilter {
		tx = tx.Where("codex_subagent_owner = ?", ownerUserID)
	}
	if err := tx.Find(&tokens).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	tokenIDs := make([]int, 0, len(tokens))
	tokenNames := map[int]string{}
	for _, token := range tokens {
		tokenIDs = append(tokenIDs, token.Id)
		tokenNames[token.Id] = token.Name
	}
	if len(tokenIDs) == 0 {
		c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"total": gin.H{}, "keys": []gin.H{}}})
		return
	}
	var logs []model.Log
	if err := model.LOG_DB.Where("type = ? AND token_id IN ?", model.LogTypeConsume, tokenIDs).Find(&logs).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	type stat struct {
		TokenID          int    `json:"token_id"`
		TokenName        string `json:"token_name"`
		PromptTokens     int64  `json:"prompt_tokens"`
		CompletionTokens int64  `json:"completion_tokens"`
		CacheTokens      int64  `json:"cache_tokens"`
		Quota            int64  `json:"quota"`
		Requests         int64  `json:"requests"`
	}
	total := stat{}
	byToken := map[int]*stat{}
	for _, token := range tokens {
		byToken[token.Id] = &stat{TokenID: token.Id, TokenName: token.Name}
	}
	for _, log := range logs {
		item := byToken[log.TokenId]
		if item == nil {
			item = &stat{TokenID: log.TokenId, TokenName: tokenNames[log.TokenId]}
			byToken[log.TokenId] = item
		}
		cacheTokens := int64(extractCodexCacheTokens(log.Other))
		item.PromptTokens += int64(log.PromptTokens)
		item.CompletionTokens += int64(log.CompletionTokens)
		item.CacheTokens += cacheTokens
		item.Quota += int64(log.Quota)
		item.Requests++
		total.PromptTokens += int64(log.PromptTokens)
		total.CompletionTokens += int64(log.CompletionTokens)
		total.CacheTokens += cacheTokens
		total.Quota += int64(log.Quota)
		total.Requests++
	}
	items := make([]stat, 0, len(byToken))
	for _, item := range byToken {
		items = append(items, *item)
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"total": total, "keys": items}})
}

func extractCodexCacheTokens(raw string) int {
	other, _ := common.StrToMap(raw)
	if other == nil {
		return 0
	}
	total := numericMapValue(other, "cache_tokens")
	total += numericMapValue(other, "cache_write_tokens")
	total += numericMapValue(other, "cache_creation_tokens")
	total += numericMapValue(other, "cache_creation_tokens_5m")
	total += numericMapValue(other, "cache_creation_tokens_1h")
	return total
}

func numericMapValue(m map[string]interface{}, key string) int {
	v, ok := m[key]
	if !ok {
		return 0
	}
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	case json.Number:
		i, _ := n.Int64()
		return int(i)
	default:
		return 0
	}
}
