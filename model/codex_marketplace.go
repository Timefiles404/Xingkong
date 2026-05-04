package model

import (
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

const (
	CodexMarketProductListed   = 1
	CodexMarketProductUnlisted = 2

	CodexMarketCodeUnused   = 1
	CodexMarketCodeRedeemed = 2
	CodexMarketCodeDisabled = 3

	CodexMarketPaymentPending  = 1
	CodexMarketPaymentApproved = 2
	CodexMarketPaymentRejected = 3
)

type CodexMarketProduct struct {
	Id                 int    `json:"id"`
	SellerID           int    `json:"seller_id" gorm:"index"`
	Title              string `json:"title" gorm:"type:varchar(128);index"`
	Description        string `json:"description" gorm:"type:text"`
	Models             string `json:"models" gorm:"type:text"`
	Quota              int    `json:"quota" gorm:"default:0"`
	KeyRPM             int    `json:"key_rpm" gorm:"default:0"`
	PaymentType        string `json:"payment_type" gorm:"type:varchar(32);default:'text'"`
	PaymentText        string `json:"payment_text" gorm:"type:text"`
	PaymentURL         string `json:"payment_url" gorm:"type:varchar(512);default:''"`
	PaymentConfirmText string `json:"payment_confirm_text" gorm:"type:text"`
	Status             int    `json:"status" gorm:"default:2;index"`
	CreatedAt          int64  `json:"created_at" gorm:"bigint"`
	UpdatedAt          int64  `json:"updated_at" gorm:"bigint"`
}

type CodexMarketCode struct {
	Id          int    `json:"id"`
	ProductID   int    `json:"product_id" gorm:"index"`
	SellerID    int    `json:"seller_id" gorm:"index"`
	BuyerID     int    `json:"buyer_id" gorm:"default:0;index"`
	TokenID     int    `json:"token_id" gorm:"default:0;index"`
	BatchID     string `json:"batch_id" gorm:"type:varchar(64);index"`
	CodeHash    string `json:"-" gorm:"type:varchar(64);uniqueIndex"`
	PlainCode   string `json:"plain_code,omitempty" gorm:"type:varchar(128);default:''"`
	CodePreview string `json:"code_preview" gorm:"type:varchar(32)"`
	Quota       int    `json:"quota" gorm:"default:0"`
	KeyRPM      int    `json:"key_rpm" gorm:"default:0"`
	Status      int    `json:"status" gorm:"default:1;index"`
	RedeemedAt  int64  `json:"redeemed_at" gorm:"bigint;default:0"`
	ExpiredAt   int64  `json:"expired_at" gorm:"bigint;default:-1"`
	CreatedAt   int64  `json:"created_at" gorm:"bigint"`
	UpdatedAt   int64  `json:"updated_at" gorm:"bigint"`
}

type CodexMarketPayment struct {
	Id         int    `json:"id"`
	ProductID  int    `json:"product_id" gorm:"index"`
	SellerID   int    `json:"seller_id" gorm:"index"`
	BuyerID    int    `json:"buyer_id" gorm:"index"`
	TokenID    int    `json:"token_id" gorm:"default:0;index"`
	Contact    string `json:"contact" gorm:"type:varchar(255);default:''"`
	Proof      string `json:"proof" gorm:"type:text"`
	Message    string `json:"message" gorm:"type:text"`
	Quota      int    `json:"quota" gorm:"default:0"`
	KeyRPM     int    `json:"key_rpm" gorm:"default:0"`
	Status     int    `json:"status" gorm:"default:1;index"`
	CreatedAt  int64  `json:"created_at" gorm:"bigint"`
	UpdatedAt  int64  `json:"updated_at" gorm:"bigint"`
	ReviewedAt int64  `json:"reviewed_at" gorm:"bigint;default:0"`
}

type CodexMarketProductPublic struct {
	CodexMarketProduct
	SellerUsername    string `json:"seller_username,omitempty"`
	SellerDisplayName string `json:"seller_display_name,omitempty"`
	AvailableCodes    int64  `json:"available_codes"`
}

type CodexMarketPaymentPublic struct {
	CodexMarketPayment
	ProductTitle     string `json:"product_title,omitempty"`
	BuyerUsername    string `json:"buyer_username,omitempty"`
	BuyerDisplayName string `json:"buyer_display_name,omitempty"`
	TokenName        string `json:"token_name,omitempty"`
	MaskedKey        string `json:"key,omitempty"`
	RemainQuota      int    `json:"remain_quota,omitempty"`
	UsedQuota        int    `json:"used_quota,omitempty"`
	UnlimitedQuota   bool   `json:"unlimited_quota,omitempty"`
}

type CodexMarketPurchasedKey struct {
	Id                int    `json:"id"`
	ProductID         int    `json:"product_id"`
	ProductTitle      string `json:"product_title"`
	SellerID          int    `json:"seller_id"`
	SellerUsername    string `json:"seller_username,omitempty"`
	SellerDisplayName string `json:"seller_display_name,omitempty"`
	TokenID           int    `json:"token_id"`
	TokenName         string `json:"token_name"`
	MaskedKey         string `json:"key"`
	Status            int    `json:"status"`
	RemainQuota       int    `json:"remain_quota"`
	UsedQuota         int    `json:"used_quota"`
	UnlimitedQuota    bool   `json:"unlimited_quota"`
	ModelLimits       string `json:"model_limits"`
	RPMLimit          int    `json:"rpm_limit"`
	CreatedTime       int64  `json:"created_time"`
	AccessedTime      int64  `json:"accessed_time"`
	RedeemedAt        int64  `json:"redeemed_at"`
}

func (p *CodexMarketProduct) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	if p.CreatedAt == 0 {
		p.CreatedAt = now
	}
	if p.UpdatedAt == 0 {
		p.UpdatedAt = now
	}
	if p.Status == 0 {
		p.Status = CodexMarketProductUnlisted
	}
	if strings.TrimSpace(p.PaymentType) == "" {
		p.PaymentType = "text"
	}
	return nil
}

func (p *CodexMarketProduct) BeforeUpdate(tx *gorm.DB) error {
	p.UpdatedAt = common.GetTimestamp()
	return nil
}

func (c *CodexMarketCode) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	if c.CreatedAt == 0 {
		c.CreatedAt = now
	}
	if c.UpdatedAt == 0 {
		c.UpdatedAt = now
	}
	if c.Status == 0 {
		c.Status = CodexMarketCodeUnused
	}
	if c.ExpiredAt == 0 {
		c.ExpiredAt = -1
	}
	return nil
}

func (c *CodexMarketCode) BeforeUpdate(tx *gorm.DB) error {
	c.UpdatedAt = common.GetTimestamp()
	return nil
}

func (p *CodexMarketPayment) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	if p.CreatedAt == 0 {
		p.CreatedAt = now
	}
	if p.UpdatedAt == 0 {
		p.UpdatedAt = now
	}
	if p.Status == 0 {
		p.Status = CodexMarketPaymentPending
	}
	return nil
}

func (p *CodexMarketPayment) BeforeUpdate(tx *gorm.DB) error {
	p.UpdatedAt = common.GetTimestamp()
	return nil
}

func NormalizeCodexMarketCode(code string) string {
	code = strings.TrimSpace(code)
	code = strings.ReplaceAll(code, " ", "")
	code = strings.ReplaceAll(code, "\n", "")
	code = strings.ReplaceAll(code, "\t", "")
	return strings.ToUpper(code)
}

func HashCodexMarketCode(code string) string {
	return common.Sha1([]byte(NormalizeCodexMarketCode(code)))
}

func MaskCodexMarketCode(code string) string {
	code = NormalizeCodexMarketCode(code)
	if len(code) <= 8 {
		return code
	}
	return code[:4] + "..." + code[len(code)-4:]
}

func GetCodexMarketProductForSeller(id int, sellerID int, isAdmin bool) (*CodexMarketProduct, error) {
	var product CodexMarketProduct
	tx := DB.Where("id = ?", id)
	if !isAdmin {
		tx = tx.Where("seller_id = ?", sellerID)
	}
	if err := tx.First(&product).Error; err != nil {
		return nil, err
	}
	return &product, nil
}

func BuildCodexMarketProductPublic(product CodexMarketProduct) CodexMarketProductPublic {
	out := CodexMarketProductPublic{CodexMarketProduct: product}
	var seller User
	if err := DB.Select("id", "username", "display_name").Where("id = ?", product.SellerID).First(&seller).Error; err == nil {
		out.SellerUsername = seller.Username
		out.SellerDisplayName = seller.DisplayName
	}
	now := common.GetTimestamp()
	_ = DB.Model(&CodexMarketCode{}).
		Where("product_id = ? AND status = ? AND (expired_at < 0 OR expired_at > ?)", product.Id, CodexMarketCodeUnused, now).
		Count(&out.AvailableCodes).Error
	return out
}

func ValidateCodexMarketSeller(userID int, isAdmin bool) error {
	if isAdmin {
		return nil
	}
	if !IsCodexSubagent(userID) {
		return errors.New("没有 Codex 子代理权限")
	}
	return nil
}
