package model

import "testing"

func TestResolveChannelAbilityModelsClustersRawUpstreamIDs(t *testing.T) {
	rules := []canonicalModelRule{
		{ModelName: "claude-4.6-opus", NameRule: NameRuleFieldMatch, Status: 1},
		{ModelName: "gemini-3.1-pro", NameRule: NameRuleFieldMatch, Status: 1},
		{ModelName: "gpt-5.5-mini", NameRule: NameRuleFieldMatch, Status: 1},
		{ModelName: "gpt-5.5", NameRule: NameRuleFieldMatch, Status: 1},
	}

	got := resolveChannelAbilityModelsWithRules([]string{
		"vendor/claude-opus-4-6",
		"cat/gemini-pro-3-1",
		"gz/gemini-3.1-pro",
		"openai/gpt-5.5-mini-latest",
	}, rules)

	want := []string{"claude-4.6-opus", "gemini-3.1-pro", "gpt-5.5-mini"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

func TestFieldMatchRequiresAllCanonicalTokens(t *testing.T) {
	if scoreCanonicalUpstreamMatch("gemini-3.1-pro", NameRuleFieldMatch, "cat/gemini-3.1-flash") > 0 {
		t.Fatal("flash should not match pro")
	}
	if scoreCanonicalUpstreamMatch("gemini-3.1-pro", NameRuleFieldMatch, "cat/gemini-pro-3-1") == 0 {
		t.Fatal("separated version tokens should match")
	}
}
