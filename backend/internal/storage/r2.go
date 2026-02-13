package storage

import (
	"context"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type R2Client struct {
	Bucket    string
	S3        *s3.Client
	Presigner *s3.PresignClient
}

func NewR2(ctx context.Context) (*R2Client, error) {
	accountID := os.Getenv("R2_ACCOUNT_ID")
	accessKey := os.Getenv("R2_ACCESS_KEY_ID")
	secretKey := os.Getenv("R2_SECRET_ACCESS_KEY")
	bucket := os.Getenv("R2_BUCKET")

	if accountID == "" || accessKey == "" || secretKey == "" || bucket == "" {
		return nil, fmt.Errorf("missing R2 env vars (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET)")
	}

	endpoint := "https://" + accountID + ".r2.cloudflarestorage.com"

	resolver := aws.EndpointResolverWithOptionsFunc(
		func(service, region string, options ...interface{}) (aws.Endpoint, error) {
			return aws.Endpoint{
				URL:               endpoint,
				SigningRegion:     "auto",
				HostnameImmutable: true,
			}, nil
		},
	)

	cfg, err := config.LoadDefaultConfig(ctx,
		config.WithRegion("auto"),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(accessKey, secretKey, "")),
		config.WithEndpointResolverWithOptions(resolver),
	)
	if err != nil {
		return nil, err
	}

	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.UsePathStyle = true // REQUIRED for R2
	})

	return &R2Client{
		Bucket:    bucket,
		S3:        client,
		Presigner: s3.NewPresignClient(client),
	}, nil
}

// ---- Presign PUT (browser upload) ----

func (r *R2Client) SignedPutURL(ctx context.Context, key, contentType string, ttl time.Duration) (string, error) {
	out, err := r.Presigner.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(r.Bucket),
		Key:         aws.String(key),
		ContentType: aws.String(contentType),
	}, func(po *s3.PresignOptions) {
		po.Expires = ttl
	})
	if err != nil {
		return "", err
	}
	return out.URL, nil
}

// ---- Server-side streaming (for /api/render-files/:id) ----

func (r *R2Client) GetObjectStream(ctx context.Context, key string) (io.ReadCloser, string, error) {
	out, err := r.S3.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(r.Bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, "", err
	}

	ctype := ""
	if out.ContentType != nil {
		ctype = *out.ContentType
	}
	if strings.TrimSpace(ctype) == "" {
		ctype = "application/octet-stream"
	}

	return out.Body, ctype, nil
}

func SignedURLTTL() time.Duration {
	// optional env: SIGNED_URL_TTL_SECONDS=600
	s := strings.TrimSpace(os.Getenv("SIGNED_URL_TTL_SECONDS"))
	if s == "" {
		return 10 * time.Minute
	}
	n, err := strconv.Atoi(s)
	if err != nil || n <= 0 {
		return 10 * time.Minute
	}
	return time.Duration(n) * time.Second
}
