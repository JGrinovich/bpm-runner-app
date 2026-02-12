package storage

import (
	"context"
	"time"

	"github.com/aws/aws-sdk-go-v2/feature/s3/presign"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type Presigner struct {
	P *presign.PresignClient
	S *S3
}

func NewPresigner(s *S3) *Presigner {
	return &Presigner{
		P: presign.NewPresignClient(s.Client),
		S: s,
	}
}

func (ps *Presigner) PresignPut(ctx context.Context, key string, contentType string, ttl time.Duration) (string, error) {
	out, err := ps.P.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket:      &ps.S.Bucket,
		Key:         &key,
		ContentType: &contentType,
	}, presign.WithExpires(ttl))
	if err != nil {
		return "", err
	}
	return out.URL, nil
}
