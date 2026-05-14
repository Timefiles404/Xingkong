package ratio_setting

import "testing"

func TestCompactModelSuffixHelpers(t *testing.T) {
	base := "gpt-5.4"
	compact := "gpt-5.4-openai-compact"

	if got := WithCompactModelSuffix(base); got != compact {
		t.Fatalf("WithCompactModelSuffix(%q) = %q, want %q", base, got, compact)
	}
	if got := WithCompactModelSuffix(compact); got != compact {
		t.Fatalf("WithCompactModelSuffix should be idempotent, got %q", got)
	}
	if got := WithoutCompactModelSuffix(compact); got != base {
		t.Fatalf("WithoutCompactModelSuffix(%q) = %q, want %q", compact, got, base)
	}
	if got := WithoutCompactModelSuffix(base); got != base {
		t.Fatalf("WithoutCompactModelSuffix should leave base model unchanged, got %q", got)
	}
}
