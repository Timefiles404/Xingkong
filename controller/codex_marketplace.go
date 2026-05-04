package controller

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type codexMarketProductRequest struct {
	SellerID           int    `json:"seller_id"`
	Title              string `json:"title"`
	Description        string `json:"description"`
	Models             string `json:"models"`
	Quota              int    `json:"quota"`
	KeyRPM             int    `json:"key_rpm"`
	PaymentType        string `json:"payment_type"`
	PaymentText        string `json:"payment_text"`
	PaymentURL         string `json:"payment_url"`
	PaymentConfirmText string `json:"payment_confirm_text"`
	Status             int    `json:"status"`
}

type codexMarketGenerateCodesRequest struct {
	ProductID int   `json:"product_id"`
	Count     int   `json:"count"`
	Quota     int   `json:"quota"`
	KeyRPM    int   `json:"key_rpm"`
	ExpiredAt int64 `json:"expired_at"`
}

type codexMarketRedeemRequest struct {
	Code string `json:"code"`
}

type codexMarketPaymentRequest struct {
	ProductID int    `json:"product_id"`
	Contact   string `json:"contact"`
	Proof     string `json:"proof"`
	Message   string `json:"message"`
}

type codexMarketReviewPaymentRequest struct {
	Status  int    `json:"status"`
	Message string `json:"message"`
}

func sanitizeCodexMarketModels(raw string) string {
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == '\n' || r == '\t' || r == ' '
	})
	allowed := map[string]bool{}
	for _, modelName := range model.CodexOfficialModelList() {
		allowed[modelName] = true
	}
	out := make([]string, 0, len(parts))
	seen := map[string]bool{}
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" || !allowed[part] || seen[part] {
			continue
		}
		seen[part] = true
		out = append(out, part)
	}
	if len(out) == 0 {
		return strings.Join(model.CodexOfficialModelList(), ",")
	}
	return strings.Join(out, ",")
}

func codexMarketSellerScope(c *gin.Context) (sellerID int, isAdmin bool, ok bool) {
	role := c.GetInt("role")
	userID := c.GetInt("id")
	isAdmin = role >= common.RoleAdminUser
	if err := model.ValidateCodexMarketSeller(userID, isAdmin); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": err.Error()})
		return 0, false, false
	}
	sellerID = userID
	if isAdmin {
		if requested, _ := strconv.Atoi(c.Query("seller_id")); requested > 0 {
			sellerID = requested
		}
	}
	return sellerID, isAdmin, true
}

func ListCodexMarketProducts(c *gin.Context) {
	var products []model.CodexMarketProduct
	if err := model.DB.Where("status = ?", model.CodexMarketProductListed).Order("id desc").Find(&products).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]model.CodexMarketProductPublic, 0, len(products))
	for _, product := range products {
		items = append(items, model.BuildCodexMarketProductPublic(product))
	}
	common.ApiSuccess(c, items)
}

func ListMyCodexMarketProducts(c *gin.Context) {
	sellerID, isAdmin, ok := codexMarketSellerScope(c)
	if !ok {
		return
	}
	tx := model.DB.Model(&model.CodexMarketProduct{})
	if !isAdmin || c.Query("seller_id") != "" {
		tx = tx.Where("seller_id = ?", sellerID)
	}
	var products []model.CodexMarketProduct
	if err := tx.Order("id desc").Find(&products).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]model.CodexMarketProductPublic, 0, len(products))
	for _, product := range products {
		items = append(items, model.BuildCodexMarketProductPublic(product))
	}
	common.ApiSuccess(c, items)
}

func CreateCodexMarketProduct(c *gin.Context) {
	sellerID, isAdmin, ok := codexMarketSellerScope(c)
	if !ok {
		return
	}
	req := codexMarketProductRequest{}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if isAdmin && req.SellerID > 0 {
		sellerID = req.SellerID
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		common.ApiErrorMsg(c, "商品名称不能为空")
		return
	}
	status := req.Status
	if status != model.CodexMarketProductListed && status != model.CodexMarketProductUnlisted {
		status = model.CodexMarketProductUnlisted
	}
	if req.Quota < 0 {
		common.ApiErrorMsg(c, "额度不能为负数")
		return
	}
	if req.KeyRPM < 0 {
		common.ApiErrorMsg(c, "RPM 不能为负数")
		return
	}
	product := model.CodexMarketProduct{
		SellerID:           sellerID,
		Title:              title,
		Description:        strings.TrimSpace(req.Description),
		Models:             sanitizeCodexMarketModels(req.Models),
		Quota:              req.Quota,
		KeyRPM:             req.KeyRPM,
		PaymentType:        strings.TrimSpace(req.PaymentType),
		PaymentText:        strings.TrimSpace(req.PaymentText),
		PaymentURL:         strings.TrimSpace(req.PaymentURL),
		PaymentConfirmText: strings.TrimSpace(req.PaymentConfirmText),
		Status:             status,
	}
	if err := model.DB.Create(&product).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, model.BuildCodexMarketProductPublic(product))
}

func UpdateCodexMarketProduct(c *gin.Context) {
	sellerID, isAdmin, ok := codexMarketSellerScope(c)
	if !ok {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	product, err := model.GetCodexMarketProductForSeller(id, sellerID, isAdmin)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	req := codexMarketProductRequest{}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if strings.TrimSpace(req.Title) != "" {
		product.Title = strings.TrimSpace(req.Title)
	}
	product.Description = strings.TrimSpace(req.Description)
	product.Models = sanitizeCodexMarketModels(req.Models)
	if req.Quota >= 0 {
		product.Quota = req.Quota
	}
	if req.KeyRPM >= 0 {
		product.KeyRPM = req.KeyRPM
	}
	if strings.TrimSpace(req.PaymentType) != "" {
		product.PaymentType = strings.TrimSpace(req.PaymentType)
	}
	product.PaymentText = strings.TrimSpace(req.PaymentText)
	product.PaymentURL = strings.TrimSpace(req.PaymentURL)
	product.PaymentConfirmText = strings.TrimSpace(req.PaymentConfirmText)
	if req.Status == model.CodexMarketProductListed || req.Status == model.CodexMarketProductUnlisted {
		product.Status = req.Status
	}
	if err := model.DB.Save(product).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, model.BuildCodexMarketProductPublic(*product))
}

func DeleteCodexMarketProduct(c *gin.Context) {
	sellerID, isAdmin, ok := codexMarketSellerScope(c)
	if !ok {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if _, err := model.GetCodexMarketProductForSeller(id, sellerID, isAdmin); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.DB.Delete(&model.CodexMarketProduct{}, id).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func GenerateCodexMarketCodes(c *gin.Context) {
	sellerID, isAdmin, ok := codexMarketSellerScope(c)
	if !ok {
		return
	}
	req := codexMarketGenerateCodesRequest{}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.Count <= 0 || req.Count > 200 {
		common.ApiErrorMsg(c, "生成数量必须在 1-200 之间")
		return
	}
	product, err := model.GetCodexMarketProductForSeller(req.ProductID, sellerID, isAdmin)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	quota := req.Quota
	if quota <= 0 {
		quota = product.Quota
	}
	if quota <= 0 {
		common.ApiErrorMsg(c, "兑换额度必须大于 0")
		return
	}
	keyRPM := req.KeyRPM
	if keyRPM < 0 {
		common.ApiErrorMsg(c, "RPM 不能为负数")
		return
	}
	if keyRPM == 0 {
		keyRPM = product.KeyRPM
	}
	codes := make([]string, 0, req.Count)
	batchID := fmt.Sprintf("batch-%d-%s", common.GetTimestamp(), common.GetRandomString(8))
	err = model.DB.Transaction(func(tx *gorm.DB) error {
		for i := 0; i < req.Count; i++ {
			random, err := common.GenerateRandomCharsKey(20)
			if err != nil {
				return err
			}
			plain := "XKCDX-" + strings.ToUpper(random[:4]) + "-" + strings.ToUpper(random[4:12]) + "-" + strings.ToUpper(random[12:])
			code := model.CodexMarketCode{
				ProductID:   product.Id,
				SellerID:    product.SellerID,
				BatchID:     batchID,
				CodeHash:    model.HashCodexMarketCode(plain),
				PlainCode:   plain,
				CodePreview: model.MaskCodexMarketCode(plain),
				Quota:       quota,
				KeyRPM:      keyRPM,
				Status:      model.CodexMarketCodeUnused,
				ExpiredAt:   req.ExpiredAt,
			}
			if code.ExpiredAt == 0 {
				code.ExpiredAt = -1
			}
			if err := tx.Create(&code).Error; err != nil {
				return err
			}
			codes = append(codes, plain)
		}
		return nil
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"codes": codes})
}

func ListCodexMarketCodes(c *gin.Context) {
	sellerID, isAdmin, ok := codexMarketSellerScope(c)
	if !ok {
		return
	}
	tx := model.DB.Model(&model.CodexMarketCode{})
	if !isAdmin || c.Query("seller_id") != "" {
		tx = tx.Where("seller_id = ?", sellerID)
	}
	if rawProductID := c.Query("product_id"); rawProductID != "" {
		productID, _ := strconv.Atoi(rawProductID)
		tx = tx.Where("product_id = ?", productID)
	}
	var codes []model.CodexMarketCode
	if err := tx.Order("id desc").Limit(500).Find(&codes).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, codes)
}

func ExportCodexMarketCodes(c *gin.Context) {
	sellerID, isAdmin, ok := codexMarketSellerScope(c)
	if !ok {
		return
	}
	tx := model.DB.Model(&model.CodexMarketCode{})
	if !isAdmin || c.Query("seller_id") != "" {
		tx = tx.Where("seller_id = ?", sellerID)
	}
	if productID, _ := strconv.Atoi(c.Query("product_id")); productID > 0 {
		tx = tx.Where("product_id = ?", productID)
	}
	if batchID := strings.TrimSpace(c.Query("batch_id")); batchID != "" {
		tx = tx.Where("batch_id = ?", batchID)
	}
	var codes []model.CodexMarketCode
	if err := tx.Order("id desc").Limit(2000).Find(&codes).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	out := make([]string, 0, len(codes))
	for _, code := range codes {
		if strings.TrimSpace(code.PlainCode) != "" {
			out = append(out, code.PlainCode)
		}
	}
	common.ApiSuccess(c, gin.H{"codes": out})
}

func DisableCodexMarketCode(c *gin.Context) {
	sellerID, isAdmin, ok := codexMarketSellerScope(c)
	if !ok {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	tx := model.DB.Model(&model.CodexMarketCode{}).Where("id = ? AND status = ?", id, model.CodexMarketCodeUnused)
	if !isAdmin {
		tx = tx.Where("seller_id = ?", sellerID)
	}
	if err := tx.Updates(map[string]any{"status": model.CodexMarketCodeDisabled}).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func RedeemCodexMarketCode(c *gin.Context) {
	userID := c.GetInt("id")
	req := codexMarketRedeemRequest{}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	normalized := model.NormalizeCodexMarketCode(req.Code)
	if normalized == "" {
		common.ApiErrorMsg(c, "请输入兑换码")
		return
	}
	hash := model.HashCodexMarketCode(normalized)
	var fullKey string
	var purchased model.CodexMarketPurchasedKey
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		var code model.CodexMarketCode
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("code_hash = ?", hash).First(&code).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				return fmt.Errorf("兑换码无效")
			}
			return err
		}
		now := common.GetTimestamp()
		if code.Status != model.CodexMarketCodeUnused {
			return fmt.Errorf("兑换码已被使用或已失效")
		}
		if code.ExpiredAt > 0 && code.ExpiredAt < now {
			return fmt.Errorf("兑换码已过期")
		}
		var product model.CodexMarketProduct
		if err := tx.Where("id = ?", code.ProductID).First(&product).Error; err != nil {
			return err
		}
		token, key, err := createCodexMarketTokenTx(tx, code.SellerID, "市场兑换-"+product.Title, code.Quota, code.KeyRPM, product.Models)
		if err != nil {
			return err
		}
		if err := tx.Model(&model.CodexMarketCode{}).Where("id = ? AND status = ?", code.Id, model.CodexMarketCodeUnused).Updates(map[string]any{
			"status":      model.CodexMarketCodeRedeemed,
			"buyer_id":    userID,
			"token_id":    token.Id,
			"redeemed_at": now,
		}).Error; err != nil {
			return err
		}
		fullKey = "sk-" + key
		purchased = buildCodexMarketPurchasedKey(code, product, *token)
		return nil
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"key": fullKey, "item": purchased})
}

func ListMyCodexMarketKeys(c *gin.Context) {
	userID := c.GetInt("id")
	var codes []model.CodexMarketCode
	if err := model.DB.Where("buyer_id = ? AND token_id > 0", userID).Order("id desc").Find(&codes).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]model.CodexMarketPurchasedKey, 0, len(codes))
	for _, code := range codes {
		var token model.Token
		if err := model.DB.Where("id = ?", code.TokenID).First(&token).Error; err != nil {
			continue
		}
		var product model.CodexMarketProduct
		_ = model.DB.Where("id = ?", code.ProductID).First(&product).Error
		items = append(items, buildCodexMarketPurchasedKey(code, product, token))
	}
	common.ApiSuccess(c, items)
}

func SubmitCodexMarketPayment(c *gin.Context) {
	userID := c.GetInt("id")
	req := codexMarketPaymentRequest{}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	var product model.CodexMarketProduct
	if err := model.DB.Where("id = ? AND status = ?", req.ProductID, model.CodexMarketProductListed).First(&product).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	if userID == product.SellerID {
		common.ApiErrorMsg(c, "不能购买自己的商品")
		return
	}
	payment := model.CodexMarketPayment{
		ProductID: product.Id,
		SellerID:  product.SellerID,
		BuyerID:   userID,
		Contact:   strings.TrimSpace(req.Contact),
		Proof:     strings.TrimSpace(req.Proof),
		Message:   strings.TrimSpace(req.Message),
		Quota:     product.Quota,
		KeyRPM:    product.KeyRPM,
		Status:    model.CodexMarketPaymentPending,
	}
	if payment.Contact == "" && payment.Proof == "" {
		common.ApiErrorMsg(c, "请填写联系方式或支付凭证")
		return
	}
	if err := model.DB.Create(&payment).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, buildCodexMarketPaymentPublic(payment))
}

func ListMyCodexMarketPayments(c *gin.Context) {
	userID := c.GetInt("id")
	var payments []model.CodexMarketPayment
	if err := model.DB.Where("buyer_id = ?", userID).Order("id desc").Limit(200).Find(&payments).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]model.CodexMarketPaymentPublic, 0, len(payments))
	for _, payment := range payments {
		items = append(items, buildCodexMarketPaymentPublic(payment))
	}
	common.ApiSuccess(c, items)
}

func GetMyCodexMarketPaymentKeySecret(c *gin.Context) {
	userID := c.GetInt("id")
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var payment model.CodexMarketPayment
	if err := model.DB.Where("id = ? AND buyer_id = ? AND token_id > 0 AND status = ?", id, userID, model.CodexMarketPaymentApproved).First(&payment).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	var token model.Token
	if err := model.DB.Where("id = ?", payment.TokenID).First(&token).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"key": "sk-" + token.Key})
}

func ListSellerCodexMarketPayments(c *gin.Context) {
	sellerID, isAdmin, ok := codexMarketSellerScope(c)
	if !ok {
		return
	}
	tx := model.DB.Model(&model.CodexMarketPayment{})
	if !isAdmin || c.Query("seller_id") != "" {
		tx = tx.Where("seller_id = ?", sellerID)
	}
	if status, _ := strconv.Atoi(c.Query("status")); status > 0 {
		tx = tx.Where("status = ?", status)
	}
	var payments []model.CodexMarketPayment
	if err := tx.Order("id desc").Limit(500).Find(&payments).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]model.CodexMarketPaymentPublic, 0, len(payments))
	for _, payment := range payments {
		items = append(items, buildCodexMarketPaymentPublic(payment))
	}
	common.ApiSuccess(c, items)
}

func ReviewCodexMarketPayment(c *gin.Context) {
	sellerID, isAdmin, ok := codexMarketSellerScope(c)
	if !ok {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	req := codexMarketReviewPaymentRequest{}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.Status != model.CodexMarketPaymentApproved && req.Status != model.CodexMarketPaymentRejected {
		common.ApiErrorMsg(c, "无效审核状态")
		return
	}
	var fullKey string
	err = model.DB.Transaction(func(tx *gorm.DB) error {
		var payment model.CodexMarketPayment
		query := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id)
		if !isAdmin {
			query = query.Where("seller_id = ?", sellerID)
		}
		if err := query.First(&payment).Error; err != nil {
			return err
		}
		if payment.Status != model.CodexMarketPaymentPending {
			return fmt.Errorf("该支付确认已处理")
		}
		updates := map[string]any{
			"status":      req.Status,
			"message":     strings.TrimSpace(req.Message),
			"reviewed_at": common.GetTimestamp(),
		}
		if req.Status == model.CodexMarketPaymentApproved {
			var product model.CodexMarketProduct
			if err := tx.Where("id = ?", payment.ProductID).First(&product).Error; err != nil {
				return err
			}
			token, key, err := createCodexMarketTokenTx(tx, payment.SellerID, "市场支付-"+product.Title, payment.Quota, payment.KeyRPM, product.Models)
			if err != nil {
				return err
			}
			updates["token_id"] = token.Id
			fullKey = "sk-" + key
		}
		return tx.Model(&model.CodexMarketPayment{}).Where("id = ?", payment.Id).Updates(updates).Error
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"key": fullKey})
}

func GetMyCodexMarketKeySecret(c *gin.Context) {
	userID := c.GetInt("id")
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var code model.CodexMarketCode
	if err := model.DB.Where("id = ? AND buyer_id = ? AND token_id > 0", id, userID).First(&code).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	var token model.Token
	if err := model.DB.Where("id = ?", code.TokenID).First(&token).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"key": "sk-" + token.Key})
}

func buildCodexMarketPurchasedKey(code model.CodexMarketCode, product model.CodexMarketProduct, token model.Token) model.CodexMarketPurchasedKey {
	out := model.CodexMarketPurchasedKey{
		Id:             code.Id,
		ProductID:      product.Id,
		ProductTitle:   product.Title,
		SellerID:       code.SellerID,
		TokenID:        token.Id,
		TokenName:      token.Name,
		MaskedKey:      token.GetMaskedKey(),
		Status:         token.Status,
		RemainQuota:    token.RemainQuota,
		UsedQuota:      token.UsedQuota,
		UnlimitedQuota: token.UnlimitedQuota,
		ModelLimits:    token.ModelLimits,
		RPMLimit:       token.RPMLimit,
		CreatedTime:    token.CreatedTime,
		AccessedTime:   token.AccessedTime,
		RedeemedAt:     code.RedeemedAt,
	}
	var seller model.User
	if err := model.DB.Select("id", "username", "display_name").Where("id = ?", code.SellerID).First(&seller).Error; err == nil {
		out.SellerUsername = seller.Username
		out.SellerDisplayName = seller.DisplayName
	}
	return out
}

func createCodexMarketTokenTx(tx *gorm.DB, sellerID int, name string, quota int, rpm int, modelsRaw string) (*model.Token, string, error) {
	if tx == nil {
		tx = model.DB
	}
	key, err := common.GenerateKey()
	if err != nil {
		return nil, "", err
	}
	if rpm < 0 {
		rpm = 0
	}
	token := model.Token{
		UserId:             sellerID,
		Name:               name,
		Key:                key,
		Status:             common.TokenStatusEnabled,
		CreatedTime:        common.GetTimestamp(),
		AccessedTime:       common.GetTimestamp(),
		ExpiredTime:        -1,
		RemainQuota:        quota,
		UnlimitedQuota:     false,
		ModelLimitsEnabled: true,
		ModelLimits:        sanitizeCodexMarketModels(modelsRaw),
		Group:              "default",
		RPMLimit:           rpm,
		CodexSubagentOnly:  true,
		CodexSubagentOwner: sellerID,
	}
	if err := tx.Create(&token).Error; err != nil {
		return nil, "", err
	}
	return &token, key, nil
}

func buildCodexMarketPaymentPublic(payment model.CodexMarketPayment) model.CodexMarketPaymentPublic {
	out := model.CodexMarketPaymentPublic{CodexMarketPayment: payment}
	var product model.CodexMarketProduct
	if err := model.DB.Select("id", "title").Where("id = ?", payment.ProductID).First(&product).Error; err == nil {
		out.ProductTitle = product.Title
	}
	var buyer model.User
	if err := model.DB.Select("id", "username", "display_name").Where("id = ?", payment.BuyerID).First(&buyer).Error; err == nil {
		out.BuyerUsername = buyer.Username
		out.BuyerDisplayName = buyer.DisplayName
	}
	if payment.TokenID > 0 {
		var token model.Token
		if err := model.DB.Where("id = ?", payment.TokenID).First(&token).Error; err == nil {
			out.TokenName = token.Name
			out.MaskedKey = token.GetMaskedKey()
			out.RemainQuota = token.RemainQuota
			out.UsedQuota = token.UsedQuota
			out.UnlimitedQuota = token.UnlimitedQuota
		}
	}
	return out
}
