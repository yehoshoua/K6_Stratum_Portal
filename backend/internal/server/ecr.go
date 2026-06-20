package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/ecr"
	ecrtypes "github.com/aws/aws-sdk-go-v2/service/ecr/types"
	"github.com/aws/aws-sdk-go-v2/service/sts"
)

type ecrCheckResponse struct {
	Exists     bool   `json:"exists"`
	Repository string `json:"repository"`
	Registry   string `json:"registry"`
	Image      string `json:"image"`
	Message    string `json:"message,omitempty"`
}

func (s *Server) handleCheckECRRepo(w http.ResponseWriter, r *http.Request) {
	clusterID := r.PathValue("id")
	image := strings.TrimSpace(r.URL.Query().Get("image"))
	if image == "" {
		http.Error(w, `{"error":"missing image query param"}`, http.StatusBadRequest)
		return
	}

	clusterConfig := s.getClusterConfig(clusterID)
	if clusterConfig == nil || clusterConfig.AWSAccountID == "" || clusterConfig.Region == "" {
		http.Error(w, `{"error":"cluster aws account or region not configured"}`, http.StatusBadRequest)
		return
	}

	resolvedImage := resolveClusterImage(image, clusterConfig)
	repository := parseRepositoryFromImage(resolvedImage)
	if repository == "" {
		http.Error(w, `{"error":"unable to parse repository from image"}`, http.StatusBadRequest)
		return
	}

	domain := defaultEcrDomain(clusterConfig.Region)
	response := ecrCheckResponse{
		Exists:     false,
		Repository: repository,
		Registry:   fmt.Sprintf("%s.dkr.ecr.%s.%s", clusterConfig.AWSAccountID, clusterConfig.Region, domain),
		Image:      resolvedImage,
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	cfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(clusterConfig.Region))
	if err != nil {
		response.Message = fmt.Sprintf("failed to load AWS config: %v", err)
		writeJSON(w, response)
		return
	}

	client := ecr.NewFromConfig(cfg)
	_, err = client.DescribeRepositories(ctx, &ecr.DescribeRepositoriesInput{
		RepositoryNames: []string{repository},
	})
	if err != nil {
		var notFound *ecrtypes.RepositoryNotFoundException
		if errors.As(err, &notFound) {
			response.Message = "repository not found"
			writeJSON(w, response)
			return
		}
		response.Message = fmt.Sprintf("failed to query repository: %v", err)
		writeJSON(w, response)
		return
	}

	response.Exists = true
	writeJSON(w, response)
}

func parseRepositoryFromImage(image string) string {
	trimmed := strings.TrimSpace(strings.TrimPrefix(image, "/"))
	if trimmed == "" {
		return ""
	}

	parts := strings.Split(trimmed, "/")
	if len(parts) > 1 && (strings.Contains(parts[0], ".") || strings.Contains(parts[0], ":") || parts[0] == "localhost") {
		trimmed = strings.Join(parts[1:], "/")
	}

	trimmed = strings.SplitN(trimmed, "@", 2)[0]
	trimmed = strings.SplitN(trimmed, ":", 2)[0]
	return strings.Trim(trimmed, "/")
}

func writeJSON(w http.ResponseWriter, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(payload)
}

func detectAWSAccountID(ctx context.Context, region string) string {
	if region == "" {
		return ""
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(region))
	if err != nil {
		return ""
	}
	out, err := sts.NewFromConfig(cfg).GetCallerIdentity(ctx, &sts.GetCallerIdentityInput{})
	if err != nil || out.Account == nil {
		return ""
	}
	return strings.TrimSpace(*out.Account)
}

func (s *Server) enrichClusterMetadata(ctx context.Context, c *ClusterConfig, persist bool) {
	if c == nil {
		return
	}
	if c.Region == "" {
		c.Region = parseRegion(c.APIServerURL)
	}
	if c.AWSAccountID == "" && c.Region != "" {
		if accountID := detectAWSAccountID(ctx, c.Region); accountID != "" {
			c.AWSAccountID = accountID
			if persist && s.db != nil {
				_ = s.db.SaveCluster(c)
			}
		}
	}
}
