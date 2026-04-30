package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

func GetModelAvailability(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "0"))
	if limit < 0 {
		limit = 0
	}
	if limit > 100 {
		limit = 100
	}

	data, err := model.GetModelAvailability(c.Query("view"), limit)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, data)
}
