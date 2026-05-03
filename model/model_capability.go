package model

import (
	"encoding/json"
	"strings"
)

type AdminModelCapabilityMeta struct {
	ImageGenerationEnabled          bool `json:"image_generation_enabled,omitempty"`
	ImageGenerationEnabledLegacyKey bool `json:"imageGenerationEnabled,omitempty"`
}

func ParseAdminModelCapabilityMeta(raw string) AdminModelCapabilityMeta {
	if strings.TrimSpace(raw) == "" {
		return AdminModelCapabilityMeta{}
	}

	var meta AdminModelCapabilityMeta
	if err := json.Unmarshal([]byte(raw), &meta); err != nil {
		return AdminModelCapabilityMeta{}
	}
	if meta.ImageGenerationEnabledLegacyKey {
		meta.ImageGenerationEnabled = true
	}
	return meta
}

// ResolveImageGenerationFlags resolves whether each requested model should be
// treated as an image-generation model. Exact-name metadata takes precedence
// over prefix/suffix/contains rules so explicit model entries can override
// broad rules.
func ResolveImageGenerationFlags(modelNames []string) (map[string]bool, error) {
	flags := make(map[string]bool, len(modelNames))
	if len(modelNames) == 0 {
		return flags, nil
	}

	type modelRule struct {
		ModelName string
		NameRule  int
		AdminMeta string
	}

	var rules []modelRule
	if err := DB.Model(&Model{}).
		Select("model_name", "name_rule", "admin_meta").
		Find(&rules).Error; err != nil {
		return nil, err
	}

	exactExists := make(map[string]bool, len(rules))
	exactFlags := make(map[string]bool, len(rules))
	prefixRules := make([]string, 0)
	suffixRules := make([]string, 0)
	containsRules := make([]string, 0)
	fieldRules := make([]string, 0)

	for _, rule := range rules {
		meta := ParseAdminModelCapabilityMeta(rule.AdminMeta)
		switch rule.NameRule {
		case NameRuleExact:
			exactExists[rule.ModelName] = true
			exactFlags[rule.ModelName] = meta.ImageGenerationEnabled
		case NameRulePrefix:
			if meta.ImageGenerationEnabled {
				prefixRules = append(prefixRules, rule.ModelName)
			}
		case NameRuleSuffix:
			if meta.ImageGenerationEnabled {
				suffixRules = append(suffixRules, rule.ModelName)
			}
		case NameRuleContains:
			if meta.ImageGenerationEnabled {
				containsRules = append(containsRules, rule.ModelName)
			}
		case NameRuleFieldMatch:
			if meta.ImageGenerationEnabled {
				fieldRules = append(fieldRules, rule.ModelName)
			}
		}
	}

	for _, modelName := range modelNames {
		if exactExists[modelName] {
			flags[modelName] = exactFlags[modelName]
			continue
		}

		for _, prefix := range prefixRules {
			if strings.HasPrefix(modelName, prefix) {
				flags[modelName] = true
				goto resolved
			}
		}
		for _, suffix := range suffixRules {
			if strings.HasSuffix(modelName, suffix) {
				flags[modelName] = true
				goto resolved
			}
		}
		for _, contains := range containsRules {
			if strings.Contains(modelName, contains) {
				flags[modelName] = true
				goto resolved
			}
		}
		for _, field := range fieldRules {
			if scoreCanonicalUpstreamMatch(field, NameRuleFieldMatch, modelName) > 0 {
				flags[modelName] = true
				goto resolved
			}
		}

		flags[modelName] = false

	resolved:
	}

	return flags, nil
}
