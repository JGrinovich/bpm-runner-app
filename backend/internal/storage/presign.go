// package storage

// import (
// 	"context"
// 	"net/url"
// 	"time"

// 	"github.com/minio/minio-go/v7"
// 	"github.com/minio/minio-go/v7/pkg/credentials"
// )

// type R2Presigner struct {
// 	Bucket string
// 	Client *minio.Client
// }

// func NewR2Presigner(ctx context.Context, accountID, accessKeyID, secretAccessKey, bucket string) (*R2Presigner, error) {
// 	// R2 endpoint (no bucket in hostname)
// 	endpoint := accountID + ".r2.cloudflarestorage.com"

// 	cli, err := minio.New(endpoint, &minio.Options{
// 		Creds:  credentials.NewStaticV4(accessKeyID, secretAccessKey, ""),
// 		Secure: true,
// 		Region: "auto",
// 	})
// 	if err != nil {
// 		return nil, err
// 	}

// 	return &R2Presigner{
// 		Bucket: bucket,
// 		Client: cli,
// 	}, nil
// }

// // PresignPut returns a signed PUT URL for uploading object `key`.
// func (p *R2Presigner) PresignPut(ctx context.Context, key, contentType string, ttl time.Duration) (string, error) {
// 	// MinIO presign supports query params; content-type is enforced by the client PUT header,
// 	// but you can also add a response-content-type if you want.
// 	u, err := p.Client.PresignedPutObject(ctx, p.Bucket, key, ttl)
// 	if err != nil {
// 		return "", err
// 	}

// 	// Ensure URL is usable as a plain string
// 	uu := u
// 	uu.RawQuery = url.Values(uu.Query()).Encode()
// 	return uu.String(), nil
// }
