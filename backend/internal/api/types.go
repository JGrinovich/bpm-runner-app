package api

type SignupRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type AuthResponse struct {
	Token string `json:"token"`
}

type CreateTrackRequest struct {
	Title             *string `json:"title"`
	SourceFilename    string  `json:"source_filename"`
	MimeType          string  `json:"mime_type"`
	DurationSec       *int    `json:"duration_sec"`
	OriginalObjectKey string  `json:"original_object_key"`
}

type TrackResponse struct {
	ID                string  `json:"id"`
	Title             *string `json:"title,omitempty"`
	SourceFilename    string  `json:"source_filename"`
	MimeType          string  `json:"mime_type"`
	DurationSec       *int    `json:"duration_sec,omitempty"`
	OriginalObjectKey string  `json:"original_object_key"`
	CreatedAt         string  `json:"created_at"`
}

type AnalyzeResponse struct {
	TrackID string `json:"track_id"`
	Status  string `json:"status"`
}

type RenderRequest struct {
	TargetBpm     float64 `json:"target_bpm"`
	PreservePitch bool    `json:"preserve_pitch"`
}

type RenderResponse struct {
	RenderID string `json:"render_id"`
	Status   string `json:"status"`
}
