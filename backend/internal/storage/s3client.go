package storage

import (
	"context"
	"os"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type S3 struct {
	Client   *s3.Client
	Bucket   string
	Prefix   string
	Region   string
	Endpoint string
}

func NewS3(ctx context.Context) (*S3, error) {
	bucket := os.Getenv("S3_BUCKET")
	endpoint := os.Getenv("S3_ENDPOINT")
	region := os.Getenv("S3_REGION")
	access := os.Getenv("S3_ACCESS_KEY_ID")
	secret := os.Getenv("S3_SECRET_ACCESS_KEY")
	prefix := os.Getenv("S3_KEY_PREFIX")
	if prefix == "" {
		prefix = "uploads"
	}

	cfg, err := config.LoadDefaultConfig(
		ctx,
		config.WithRegion(region),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(access, secret, "")),
	)
	if err != nil {
		return nil, err
	}

	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		// R2/S3-compatible endpoint
		o.BaseEndpoint = aws.String(endpoint)
		// R2 needs path-style addressing
		o.UsePathStyle = true
	})

	return &S3{
		Client:   client,
		Bucket:   bucket,
		Prefix:   prefix,
		Region:   region,
		Endpoint: endpoint,
	}, nil
}
