package controller

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetProfitOverview(c *gin.Context) {
	period := strings.TrimSpace(c.Query("period"))
	switch period {
	case "week", "month":
	default:
		period = "day"
	}
	overview, err := model.GetProfitOverview(period)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, overview)
}
