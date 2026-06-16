package server

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"k6-bedrock-dashboard/backend/internal/auth"
	"k6-bedrock-dashboard/backend/internal/config"
	"k6-bedrock-dashboard/backend/internal/database"
	"k6-bedrock-dashboard/backend/internal/influx"
	"k6-bedrock-dashboard/backend/internal/k8s"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

type ClusterConfig = database.ClusterConfig

type Server struct {
	config        *config.Config
	authSvc       *auth.AuthService
	influxSvc     *influx.MetricsService
	db            *database.DB
	clientCache   map[string]*k8s.EKSClusterClient
	clientCacheMu sync.RWMutex
}

func NewServer(cfg *config.Config, db *database.DB) *Server {
	authSvc := auth.NewAuthService(cfg.JWTSecret, db)
	
	var active *database.InfluxConfig
	if cfg.InfluxURL != "" {
		active = &database.InfluxConfig{
			ID:        "influx-env",
			Name:      "Environment Config",
			Version:   "v2",
			URL:       cfg.InfluxURL,
			Token:     cfg.InfluxToken,
			Org:       cfg.InfluxOrg,
			Bucket:    cfg.InfluxBucket,
			Method:    "POST",
			IsActive:  true,
			CreatedAt: time.Now(),
		}
	} else if db != nil {
		var err error
		active, err = db.GetActiveInfluxConfig()
		if err != nil {
			log.Printf("Warning: failed to query active InfluxDB config: %v", err)
		}

		if active == nil {
			// Migrate legacy single settings from settings table if present
			legacyURL, _ := db.GetSetting("influx_url")
			if legacyURL != "" {
				legacyVersion, _ := db.GetSetting("influx_version")
				if legacyVersion == "" {
					legacyVersion = "v2"
				}
				legacyToken, _ := db.GetSetting("influx_token")
				legacyOrg, _ := db.GetSetting("influx_org")
				legacyBucket, _ := db.GetSetting("influx_bucket")
				legacyUsername, _ := db.GetSetting("influx_username")
				legacyPassword, _ := db.GetSetting("influx_password")
				legacyMethod, _ := db.GetSetting("influx_method")
				if legacyMethod == "" {
					legacyMethod = "POST"
				}

				active = &database.InfluxConfig{
					ID:        "influx-default",
					Name:      "Default InfluxDB",
					Version:   legacyVersion,
					URL:       legacyURL,
					Token:     legacyToken,
					Org:       legacyOrg,
					Bucket:    legacyBucket,
					Username:  legacyUsername,
					Password:  legacyPassword,
					Method:    legacyMethod,
					IsActive:  true,
					CreatedAt: time.Now(),
				}

				if err := db.SaveInfluxConfig(active); err == nil {
					_ = db.SetActiveInfluxConfig(active.ID)
					log.Printf("Migrated legacy InfluxDB config into new multi-server table under ID: %s", active.ID)
				}
			}
		}
	}

	versionVal := "v2"
	urlVal := cfg.InfluxURL
	tokenVal := cfg.InfluxToken
	orgVal := cfg.InfluxOrg
	bucketVal := cfg.InfluxBucket
	usernameVal := ""
	passwordVal := ""
	methodVal := "POST"

	if active != nil {
		versionVal = active.Version
		urlVal = active.URL
		tokenVal = active.Token
		orgVal = active.Org
		bucketVal = active.Bucket
		usernameVal = active.Username
		passwordVal = active.Password
		methodVal = active.Method

		cfg.InfluxURL = active.URL
		cfg.InfluxToken = active.Token
		cfg.InfluxOrg = active.Org
		cfg.InfluxBucket = active.Bucket
	}

	var influxSvc *influx.MetricsService
	if urlVal != "" {
		influxSvc = influx.NewMetricsService(versionVal, urlVal, tokenVal, orgVal, bucketVal, usernameVal, passwordVal, methodVal)
	} else {
		// Initialize empty MetricsService without mock configs
		influxSvc = influx.NewMetricsService("v2", "", "", "", "", "", "", "POST")
	}

	s := &Server{
		config:      cfg,
		authSvc:     authSvc,
		influxSvc:   influxSvc,
		db:          db,
		clientCache: make(map[string]*k8s.EKSClusterClient),
	}

	return s
}

// Start launches the HTTP server
func (s *Server) Start() error {
	mux := http.NewServeMux()

	// Auth routes
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("POST /api/auth/sso", s.handleSSO)
	mux.HandleFunc("GET /api/auth/me", s.authMiddleware(s.handleMe))

	// K8s Clusters routes (read public, write admin-only)
	mux.HandleFunc("GET /api/k8s/clusters", s.authMiddleware(s.handleListClusters))
	mux.HandleFunc("POST /api/k8s/clusters", s.authMiddleware(s.adminOnly(s.handleRegisterCluster)))
	mux.HandleFunc("PUT /api/k8s/clusters/{id}", s.authMiddleware(s.adminOnly(s.handleUpdateCluster)))
	mux.HandleFunc("DELETE /api/k8s/clusters/{id}", s.authMiddleware(s.adminOnly(s.handleDeleteCluster)))
	mux.HandleFunc("GET /api/k8s/clusters/{id}/namespaces", s.authMiddleware(s.handleListNamespaces))
	mux.HandleFunc("GET /api/k8s/local-contexts", s.authMiddleware(s.adminOnly(s.handleListLocalContexts)))
	mux.HandleFunc("GET /api/k8s/operator-status", s.authMiddleware(s.handleGetOperatorStatus))
	mux.HandleFunc("GET /api/k8s/active-tests", s.authMiddleware(s.handleGetActiveTests))

	// Settings routes (admin only)
	mux.HandleFunc("GET /api/settings/influxdb", s.authMiddleware(s.adminOnly(s.handleGetInfluxDBConfig)))
	mux.HandleFunc("POST /api/settings/influxdb", s.authMiddleware(s.adminOnly(s.handleSetInfluxDBConfig)))
	mux.HandleFunc("POST /api/settings/influxdb/test", s.authMiddleware(s.adminOnly(s.handleTestInfluxDBConfig)))
	mux.HandleFunc("GET /api/settings/influxdb/servers", s.authMiddleware(s.handleListInfluxServers))
	mux.HandleFunc("POST /api/settings/influxdb/servers", s.authMiddleware(s.adminOnly(s.handleCreateInfluxServer)) )
	mux.HandleFunc("PUT /api/settings/influxdb/servers/{id}", s.authMiddleware(s.adminOnly(s.handleUpdateInfluxServer)))
	mux.HandleFunc("DELETE /api/settings/influxdb/servers/{id}", s.authMiddleware(s.adminOnly(s.handleDeleteInfluxServer)))
	mux.HandleFunc("POST /api/settings/influxdb/servers/{id}/activate", s.authMiddleware(s.handleActivateInfluxServer))

	// Settings User Management routes (admin only)
	mux.HandleFunc("GET /api/settings/users", s.authMiddleware(s.adminOnly(s.handleListUsers)))
	mux.HandleFunc("POST /api/settings/users", s.authMiddleware(s.adminOnly(s.handleCreateUser)))
	mux.HandleFunc("DELETE /api/settings/users/{username}", s.authMiddleware(s.adminOnly(s.handleDeleteUser)))

	// Settings SSO/OIDC routes
	mux.HandleFunc("GET /api/settings/sso", s.authMiddleware(s.adminOnly(s.handleGetSSOConfig)))
	mux.HandleFunc("POST /api/settings/sso", s.authMiddleware(s.adminOnly(s.handleSetSSOConfig)))
	mux.HandleFunc("GET /api/auth/sso/status", s.handleGetSSOStatus)
	mux.HandleFunc("GET /api/auth/sso/url", s.handleGetSSOAuthorizeURL)
	mux.HandleFunc("POST /api/auth/sso/callback", s.handleSSOCallbackExchange)

	// K6 Run Template routes
	mux.HandleFunc("GET /api/settings/templates", s.authMiddleware(s.handleListTemplates))
	mux.HandleFunc("POST /api/settings/templates", s.authMiddleware(s.editorOrAdmin(s.handleCreateTemplate)))
	mux.HandleFunc("PUT /api/settings/templates/{id}", s.authMiddleware(s.editorOrAdmin(s.handleUpdateTemplate)))
	mux.HandleFunc("DELETE /api/settings/templates/{id}", s.authMiddleware(s.editorOrAdmin(s.handleDeleteTemplate)))

	// API Tokens management routes
	mux.HandleFunc("GET /api/settings/tokens", s.authMiddleware(s.adminOnly(s.handleListAPITokens)))
	mux.HandleFunc("POST /api/settings/tokens", s.authMiddleware(s.adminOnly(s.handleGenerateAPIToken)))
	mux.HandleFunc("DELETE /api/settings/tokens/{hash}", s.authMiddleware(s.adminOnly(s.handleDeleteAPIToken)))

	// K6 CRD observability routes
	mux.HandleFunc("GET /api/k8s/clusters/{id}/crds", s.authMiddleware(s.handleListCRDs))
	mux.HandleFunc("POST /api/k8s/clusters/{id}/crds", s.authMiddleware(s.editorOrAdmin(s.handleCreateCRD)))
	mux.HandleFunc("DELETE /api/k8s/clusters/{id}/crds/{name}", s.authMiddleware(s.editorOrAdmin(s.handleDeleteCRD)))
	mux.HandleFunc("POST /api/k8s/clusters/{id}/crds/{name}/relaunch", s.authMiddleware(s.editorOrAdmin(s.handleRelaunchCRD)))
	mux.HandleFunc("GET /api/k8s/clusters/{id}/configmaps/{name}", s.authMiddleware(s.handleGetConfigMap))
	mux.HandleFunc("GET /api/k8s/clusters/{id}/configmaps", s.authMiddleware(s.handleListConfigMaps))
	mux.HandleFunc("PUT /api/k8s/clusters/{id}/configmaps/{name}", s.authMiddleware(s.editorOrAdmin(s.handleUpdateConfigMap)))
	mux.HandleFunc("DELETE /api/k8s/clusters/{id}/configmaps/{name}", s.authMiddleware(s.editorOrAdmin(s.handleDeleteConfigMap)))
	mux.HandleFunc("POST /api/k8s/clusters/{id}/configmaps", s.authMiddleware(s.editorOrAdmin(s.handleCreateConfigMap)))

	// InfluxDB telemetry routes
	mux.HandleFunc("GET /api/influx/runs", s.authMiddleware(s.handleListTestRuns))
	mux.HandleFunc("GET /api/influx/runs/{run_id}/metrics", s.authMiddleware(s.handleGetRunMetrics))
	mux.HandleFunc("GET /api/influx/runs/{run_id}/stream", s.authMiddleware(s.handleStreamRunMetrics))
	mux.HandleFunc("GET /api/influx/alerts", s.authMiddleware(s.handleListAlerts))

	// Pod log streaming route
	mux.HandleFunc("GET /api/k8s/clusters/{id}/pods", s.authMiddleware(s.handleListPods))
	mux.HandleFunc("GET /api/k8s/clusters/{id}/pods/{pod_name}/logs", s.authMiddleware(s.handleGetPodLogs))

	// Schedules routes
	mux.HandleFunc("GET /api/settings/schedules", s.authMiddleware(s.handleListSchedules))
	mux.HandleFunc("POST /api/settings/schedules", s.authMiddleware(s.editorOrAdmin(s.handleCreateSchedule)))
	mux.HandleFunc("DELETE /api/settings/schedules/{id}", s.authMiddleware(s.editorOrAdmin(s.handleDeleteSchedule)))
	mux.HandleFunc("POST /api/settings/schedules/{id}/run", s.authMiddleware(s.editorOrAdmin(s.handleRunSchedule)))
	mux.HandleFunc("POST /api/settings/schedules/{id}/toggle", s.authMiddleware(s.editorOrAdmin(s.handleToggleSchedule)))

	// Wrap in CORS middleware
	handler := s.corsMiddleware(mux)

	log.Printf("Server listening on port %s", s.config.Port)
	return http.ListenAndServe(":"+s.config.Port, handler)
}

// corsMiddleware sets up CORS headers for development/production
func (s *Server) corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*") // Adjust in production
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// authMiddleware secures routes using JWT or API Tokens
func (s *Server) authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		var tokenStr string
		if strings.HasPrefix(authHeader, "Bearer ") {
			tokenStr = strings.TrimPrefix(authHeader, "Bearer ")
		} else if qTok := r.URL.Query().Get("token"); qTok != "" {
			tokenStr = qTok
		} else {
			http.Error(w, `{"error":"missing authorization token"}`, http.StatusUnauthorized)
			return
		}

		var username, role string

		if strings.HasPrefix(tokenStr, "stratum_tok_") {
			// Validate API Token
			hasher := sha256.New()
			hasher.Write([]byte(tokenStr))
			tokenHash := hex.EncodeToString(hasher.Sum(nil))

			tok, err := s.db.GetAPITokenByHash(tokenHash)
			if err != nil || tok == nil {
				http.Error(w, `{"error":"invalid API token"}`, http.StatusUnauthorized)
				return
			}

			if tok.ExpiresAt != nil && tok.ExpiresAt.Before(time.Now()) {
				http.Error(w, `{"error":"expired API token"}`, http.StatusUnauthorized)
				return
			}

			username = "api-token:" + tok.Name
			role = tok.Role
		} else {
			// Validate JWT User Token
			var err error
			username, role, err = s.authSvc.ValidateToken(tokenStr)
			if err != nil {
				http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusUnauthorized)
				return
			}
		}

		// Inject user info into headers/context
		r.Header.Set("X-User-Name", username)
		r.Header.Set("X-User-Role", role)

		next.ServeHTTP(w, r)
	}
}

// adminOnly secures endpoints requiring administrator privileges
func (s *Server) adminOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		role := r.Header.Get("X-User-Role")
		if role != "administrator" && role != "admin" {
			http.Error(w, `{"error":"forbidden: administrator role required"}`, http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	}
}

// editorOrAdmin secures endpoints requiring editor or administrator privileges
func (s *Server) editorOrAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		role := r.Header.Get("X-User-Role")
		if role != "administrator" && role != "admin" && role != "editor" && role != "edit" {
			http.Error(w, `{"error":"forbidden: editor or administrator role required"}`, http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	}
}

// --- Handler Implementations ---

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}

	token, role, err := s.authSvc.LoginLocal(body.Username, body.Password)
	if err != nil {
		http.Error(w, `{"error":"invalid username or password"}`, http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"token":    token,
		"username": body.Username,
		"role":     role,
	})
}

func (s *Server) handleSSO(w http.ResponseWriter, r *http.Request) {
	var body struct {
		User  string `json:"user"`
		Email string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}

	token, role, err := s.authSvc.HandleSSOCallback(body.User, body.Email)
	if err != nil {
		http.Error(w, `{"error":"SSO authentication failed"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"token":    token,
		"username": body.User,
		"role":     role,
	})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"username": r.Header.Get("X-User-Name"),
		"role":     r.Header.Get("X-User-Role"),
	})
}

func (s *Server) handleListClusters(w http.ResponseWriter, r *http.Request) {
	var list []*ClusterConfig
	var err error
	if s.db != nil {
		list, err = s.db.GetClusters()
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"failed to get clusters: %v"}`, err), http.StatusInternalServerError)
			return
		}
	} else {
		list = make([]*ClusterConfig, 0)
	}

	for _, c := range list {
		// Populate region dynamically if not set
		if c.Region == "" {
			c.Region = parseRegion(c.APIServerURL)
		}
		// Populate version dynamically if not set
		if c.KubernetesVersion == "" {
			c.KubernetesVersion = s.queryKubernetesVersion(c.ID)
		}
		c.K6OperatorInstalled = s.checkK6OperatorInstalled(c.ID)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(list)
}

func (s *Server) handleRegisterCluster(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name         string `json:"name"`
		APIServerURL string `json:"api_server_url"`
		AuthType     string `json:"auth_type"` // "kubeconfig", "token", or "local"
		RawSecret    string `json:"raw_secret"` // kubeconfig YAML, SA Token, or context name
		CACertBase64 string `json:"ca_cert_base64"`
		Namespaces   string `json:"namespaces"` // Comma-separated list of namespaces
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	// For local auth type, try to resolve context and api server URL dynamically
	if body.AuthType == "local" {
		if body.RawSecret == "" {
			_, current, err := k8s.GetLocalContexts()
			if err == nil {
				body.RawSecret = current
			}
		}
		if body.APIServerURL == "" && body.RawSecret != "" {
			contexts, _, err := k8s.GetLocalContexts()
			if err == nil {
				for _, ctx := range contexts {
					if ctx.ContextName == body.RawSecret {
						body.APIServerURL = ctx.APIServerURL
						break
					}
				}
			}
		}
	}

	if body.AuthType == "in-cluster" {
		if body.APIServerURL == "" {
			body.APIServerURL = "in-cluster"
		}
		if body.RawSecret == "" {
			body.RawSecret = "in-cluster"
		}
	}

	if body.Name == "" || body.APIServerURL == "" || body.RawSecret == "" {
		http.Error(w, `{"error":"missing required fields"}`, http.StatusBadRequest)
		return
	}

	// Encrypt the sensitive secret (kubeconfig YAML, SA Token, or local context name)
	encryptedData, err := s.config.Encrypt([]byte(body.RawSecret))
	if err != nil {
		http.Error(w, `{"error":"failed to secure token"}`, http.StatusInternalServerError)
		return
	}

	id := fmt.Sprintf("eks-%d", time.Now().UnixNano())
	newCluster := &ClusterConfig{
		ID:            id,
		Name:          body.Name,
		APIServerURL:  body.APIServerURL,
		AuthType:      body.AuthType,
		EncryptedData: encryptedData,
		CACertBase64:  body.CACertBase64,
		CreatedAt:     time.Now(),
		Namespaces:    body.Namespaces,
	}

	if s.db != nil {
		if err := s.db.SaveCluster(newCluster); err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"failed to save cluster: %v"}`, err), http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(newCluster)
}

func (s *Server) handleUpdateCluster(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"error":"missing cluster id"}`, http.StatusBadRequest)
		return
	}

	var body struct {
		Name         string `json:"name"`
		APIServerURL string `json:"api_server_url"`
		AuthType     string `json:"auth_type"` // "kubeconfig", "token", or "local"
		RawSecret    string `json:"raw_secret"` // Optional if preserving existing
		CACertBase64 string `json:"ca_cert_base64"`
		Namespaces   string `json:"namespaces"` // Comma-separated list of namespaces
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	// Fetch existing cluster
	var existing *ClusterConfig
	if s.db != nil {
		clusters, err := s.db.GetClusters()
		if err == nil {
			for _, c := range clusters {
				if c.ID == id {
					existing = c
					break
				}
			}
		}
	}

	if existing == nil {
		http.Error(w, `{"error":"cluster not found"}`, http.StatusNotFound)
		return
	}

	if body.AuthType == "in-cluster" {
		if body.APIServerURL == "" {
			body.APIServerURL = "in-cluster"
		}
		if body.RawSecret == "" && existing.AuthType != "in-cluster" {
			body.RawSecret = "in-cluster"
		}
	}

	// Encrypt the sensitive secret if a new one is provided, otherwise keep existing
	encryptedData := existing.EncryptedData
	if body.RawSecret != "" {
		var err error
		encryptedData, err = s.config.Encrypt([]byte(body.RawSecret))
		if err != nil {
			http.Error(w, `{"error":"failed to secure token"}`, http.StatusInternalServerError)
			return
		}
	}

	updatedCluster := &ClusterConfig{
		ID:            id,
		Name:          body.Name,
		APIServerURL:  body.APIServerURL,
		AuthType:      body.AuthType,
		EncryptedData: encryptedData,
		CACertBase64:  body.CACertBase64,
		CreatedAt:     existing.CreatedAt,
		Namespaces:    body.Namespaces,
	}

	if s.db != nil {
		if err := s.db.SaveCluster(updatedCluster); err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"failed to save cluster: %v"}`, err), http.StatusInternalServerError)
			return
		}
	}

	// Invalidate client connection cache for this cluster ID
	s.clientCacheMu.Lock()
	delete(s.clientCache, id)
	s.clientCacheMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(updatedCluster)
}

func (s *Server) handleDeleteCluster(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"error":"missing cluster id"}`, http.StatusBadRequest)
		return
	}

	if s.db != nil {
		if err := s.db.DeleteCluster(id); err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"failed to delete cluster: %v"}`, err), http.StatusInternalServerError)
			return
		}
	}

	s.clientCacheMu.Lock()
	delete(s.clientCache, id)
	s.clientCacheMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}

func (s *Server) getClusterClient(id string) (*k8s.EKSClusterClient, bool, error) {
	s.clientCacheMu.RLock()
	client, cached := s.clientCache[id]
	s.clientCacheMu.RUnlock()
	if cached {
		return client, false, nil
	}

	var clusterConfig *ClusterConfig
	if s.db != nil {
		clusters, err := s.db.GetClusters()
		if err != nil {
			return nil, false, fmt.Errorf("failed to get clusters from db: %w", err)
		}
		for _, c := range clusters {
			if c.ID == id {
				clusterConfig = c
				break
			}
		}
	}

	if clusterConfig == nil {
		return nil, false, fmt.Errorf("cluster not found")
	}

	if clusterConfig.AuthType == "mock" || clusterConfig.APIServerURL == "mock" || strings.HasPrefix(clusterConfig.APIServerURL, "mock") {
		return nil, true, nil
	}

	var newClient *k8s.EKSClusterClient
	var err error

	if clusterConfig.AuthType == "in-cluster" {
		newClient, err = k8s.NewClientFromInCluster()
		if err != nil {
			return nil, false, fmt.Errorf("failed to connect to in-cluster config: %w", err)
		}
	} else if clusterConfig.AuthType == "local" {
		decryptedContext, err := s.config.Decrypt(clusterConfig.EncryptedData)
		if err != nil {
			return nil, false, fmt.Errorf("failed to decrypt cluster credentials: %w", err)
		}
		newClient, err = k8s.NewClientFromLocalKubeconfig(string(decryptedContext))
		if err != nil {
			return nil, false, fmt.Errorf("failed to connect to local cluster context %s: %w", string(decryptedContext), err)
		}
	} else {
		// Decrypt connection credentials
		decryptedSecret, err := s.config.Decrypt(clusterConfig.EncryptedData)
		if err != nil {
			return nil, false, fmt.Errorf("failed to decrypt cluster credentials: %w", err)
		}

		if clusterConfig.AuthType == "kubeconfig" {
			newClient, err = k8s.NewClientFromKubeconfig(decryptedSecret)
		} else {
			newClient, err = k8s.NewClientFromToken(clusterConfig.APIServerURL, string(decryptedSecret), clusterConfig.CACertBase64)
		}
		if err != nil {
			return nil, false, fmt.Errorf("failed to connect to cluster: %w", err)
		}
	}

	s.clientCacheMu.Lock()
	s.clientCache[id] = newClient
	s.clientCacheMu.Unlock()

	return newClient, false, nil
}

func (s *Server) handleListCRDs(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	namespace := r.URL.Query().Get("namespace")
	if namespace == "all" {
		namespace = ""
	} else if namespace == "" {
		namespace = "default"
	}

	client, isMock, err := s.getClusterClient(id)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if isMock {
		json.NewEncoder(w).Encode(s.getMockK6CRDs(namespace))
		return
	}

	var resultList []interface{}

	// 1. List K6 CRDs
	crdItems, err := client.ListK6CustomResources(r.Context(), namespace)
	if err == nil {
		for _, item := range crdItems {
			resultList = append(resultList, item.Object)
		}
	}

	// 2. List Jobs
	jobList, err := client.Clientset.BatchV1().Jobs(namespace).List(r.Context(), metav1.ListOptions{
		LabelSelector: "k6s=enabled",
	})
	if err == nil {
		for _, job := range jobList.Items {
			resultList = append(resultList, s.mapJobToUI(&job))
		}
	}

	// 3. List CronJobs
	cjList, err := client.Clientset.BatchV1().CronJobs(namespace).List(r.Context(), metav1.ListOptions{
		LabelSelector: "k6s=enabled",
	})
	if err == nil {
		for _, cj := range cjList.Items {
			resultList = append(resultList, s.mapCronJobToUI(&cj))
		}
	}

	if resultList == nil {
		resultList = []interface{}{}
	}

	json.NewEncoder(w).Encode(resultList)
}

func (s *Server) handleCreateCRD(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	namespace := r.URL.Query().Get("namespace")
	if namespace == "" {
		namespace = "default"
	}

	client, isMock, err := s.getClusterClient(id)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	var payload struct {
		Name           string                 `json:"name"`
		ScriptContent  string                 `json:"scriptContent"`
		Schedule       bool                   `json:"schedule"`
		CronExpression string                 `json:"cronExpression"`
		Spec           map[string]interface{} `json:"spec"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	configMapName := "cm-" + payload.Name
	scriptFile := "script.js"

	specMap := payload.Spec
	if specMap != nil {
		if scriptMap, ok := specMap["script"].(map[string]interface{}); ok {
			if cmMap, ok := scriptMap["configMap"].(map[string]interface{}); ok {
				if name, ok := cmMap["name"].(string); ok && name != "" {
					configMapName = name
				}
				if file, ok := cmMap["file"].(string); ok && file != "" {
					scriptFile = file
				}
			}
		}
	}

	if payload.ScriptContent != "" && !isMock {
		cm := &corev1.ConfigMap{
			ObjectMeta: metav1.ObjectMeta{
				Name:      configMapName,
				Namespace: namespace,
				Labels: map[string]string{
					"k6s": "enabled",
				},
			},
			Data: map[string]string{
				scriptFile: payload.ScriptContent,
			},
		}

		cmClient := client.Clientset.CoreV1().ConfigMaps(namespace)
		_, getErr := cmClient.Get(r.Context(), configMapName, metav1.GetOptions{})
		if getErr != nil {
			_, err = cmClient.Create(r.Context(), cm, metav1.CreateOptions{})
			if err != nil {
				http.Error(w, fmt.Sprintf(`{"error":"failed to create ConfigMap: %v"}`, err), http.StatusInternalServerError)
				return
			}
		} else {
			_, err = cmClient.Update(r.Context(), cm, metav1.UpdateOptions{})
			if err != nil {
				http.Error(w, fmt.Sprintf(`{"error":"failed to update ConfigMap: %v"}`, err), http.StatusInternalServerError)
				return
			}
		}
	}

	if isMock {
		w.Header().Set("Content-Type", "application/json")
		if payload.Schedule {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"kind": "CronJob",
				"metadata": map[string]interface{}{
					"name":              payload.Name,
					"namespace":         namespace,
					"creationTimestamp": time.Now().Format(time.RFC3339),
				},
				"spec": map[string]interface{}{
					"parallelism": 1,
					"schedule":    payload.CronExpression,
				},
				"status": map[string]interface{}{
					"stage": "scheduled",
				},
			})
		} else {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"kind": "Job",
				"metadata": map[string]interface{}{
					"name":              payload.Name,
					"namespace":         namespace,
					"creationTimestamp": time.Now().Format(time.RFC3339),
				},
				"spec": map[string]interface{}{
					"parallelism": 1,
				},
				"status": map[string]interface{}{
					"stage": "running",
				},
			})
		}
		return
	}

	var parallelismVal int32 = 1
	if specMap != nil {
		if p, ok := specMap["parallelism"].(float64); ok {
			parallelismVal = int32(p)
		} else if p, ok := specMap["parallelism"].(int); ok {
			parallelismVal = int32(p)
		}
	}

	image := "grafana/k6:latest"
	var limits corev1.ResourceList
	if specMap != nil {
		if runnerMap, ok := specMap["runner"].(map[string]interface{}); ok {
			if specRunnerImage, ok := runnerMap["image"].(string); ok && specRunnerImage != "" {
				image = specRunnerImage
			}
			if resMap, ok := runnerMap["resources"].(map[string]interface{}); ok {
				if limMap, ok := resMap["limits"].(map[string]interface{}); ok {
					limits = make(corev1.ResourceList)
					if cpuVal, ok := limMap["cpu"].(string); ok && cpuVal != "" {
						if q, err := resource.ParseQuantity(cpuVal); err == nil {
							limits[corev1.ResourceCPU] = q
						}
					}
					if memVal, ok := limMap["memory"].(string); ok && memVal != "" {
						if q, err := resource.ParseQuantity(memVal); err == nil {
							limits[corev1.ResourceMemory] = q
						}
					}
				}
			}
		}
	}

	resources := corev1.ResourceRequirements{}
	if len(limits) > 0 {
		resources.Limits = limits
	}

	var runArgs []string
	runArgs = append(runArgs, "run", "/script/"+scriptFile)
	if specMap != nil {
		if argsVal, ok := specMap["arguments"].(string); ok && argsVal != "" {
			parts := strings.Fields(argsVal)
			runArgs = append(runArgs, parts...)
		}
	}
	jobSpec := batchv1.JobSpec{
		Parallelism: &parallelismVal,
		Template: corev1.PodTemplateSpec{
			ObjectMeta: metav1.ObjectMeta{
				Labels: map[string]string{
					"k6s": "enabled",
				},
			},
			Spec: corev1.PodSpec{
				RestartPolicy: corev1.RestartPolicyNever,
				Containers: []corev1.Container{
					{
						Name:      "k6-runner",
						Image:     image,
						Args:      runArgs,
						Resources: resources,
						VolumeMounts: []corev1.VolumeMount{
							{
								Name:      "script-volume",
								MountPath: "/script",
							},
						},
					},
				},
				Volumes: []corev1.Volume{
					{
						Name: "script-volume",
						VolumeSource: corev1.VolumeSource{
							ConfigMap: &corev1.ConfigMapVolumeSource{
								LocalObjectReference: corev1.LocalObjectReference{
									Name: configMapName,
								},
							},
						},
					},
				},
			},
		},
	}

	if payload.Schedule {
		cronJob := &batchv1.CronJob{
			TypeMeta: metav1.TypeMeta{
				APIVersion: "batch/v1",
				Kind:       "CronJob",
			},
			ObjectMeta: metav1.ObjectMeta{
				Name:      payload.Name,
				Namespace: namespace,
				Labels: map[string]string{
					"k6s": "enabled",
				},
			},
			Spec: batchv1.CronJobSpec{
				Schedule:          payload.CronExpression,
				ConcurrencyPolicy: batchv1.ForbidConcurrent,
				JobTemplate: batchv1.JobTemplateSpec{
					ObjectMeta: metav1.ObjectMeta{
						Labels: map[string]string{
							"k6s": "enabled",
						},
					},
					Spec: jobSpec,
				},
			},
		}

		createdCronJob, err := client.Clientset.BatchV1().CronJobs(namespace).Create(r.Context(), cronJob, metav1.CreateOptions{})
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"failed to create CronJob: %v"}`, err), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(s.mapCronJobToUI(createdCronJob))
	} else {
		job := &batchv1.Job{
			TypeMeta: metav1.TypeMeta{
				APIVersion: "batch/v1",
				Kind:       "Job",
			},
			ObjectMeta: metav1.ObjectMeta{
				Name:      payload.Name,
				Namespace: namespace,
				Labels: map[string]string{
					"k6s": "enabled",
				},
			},
			Spec: jobSpec,
		}

		createdJob, err := client.Clientset.BatchV1().Jobs(namespace).Create(r.Context(), job, metav1.CreateOptions{})
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"failed to create Job: %v"}`, err), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(s.mapJobToUI(createdJob))
	}
}

func (s *Server) handleDeleteCRD(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	name := r.PathValue("name")
	namespace := r.URL.Query().Get("namespace")
	if namespace == "" {
		namespace = "default"
	}

	client, isMock, err := s.getClusterClient(id)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	if isMock {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"success":true}`))
		return
	}

	// Try deleting as a Job
	jobErr := client.Clientset.BatchV1().Jobs(namespace).Delete(r.Context(), name, metav1.DeleteOptions{})
	if jobErr == nil {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"success":true}`))
		return
	}

	// Try deleting as a CronJob
	cjErr := client.Clientset.BatchV1().CronJobs(namespace).Delete(r.Context(), name, metav1.DeleteOptions{})
	if cjErr == nil {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"success":true}`))
		return
	}

	err = client.DeleteK6CustomResource(r.Context(), namespace, name)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}

func (s *Server) mapJobToUI(job *batchv1.Job) map[string]interface{} {
	cmName := ""
	cmFile := ""
	if len(job.Spec.Template.Spec.Volumes) > 0 {
		for _, vol := range job.Spec.Template.Spec.Volumes {
			if vol.ConfigMap != nil {
				cmName = vol.ConfigMap.Name
				break
			}
		}
	}
	if len(job.Spec.Template.Spec.Containers) > 0 && len(job.Spec.Template.Spec.Containers[0].Args) >= 2 {
		args := job.Spec.Template.Spec.Containers[0].Args
		if args[0] == "run" {
			cmFile = strings.TrimPrefix(args[1], "/script/")
		}
	}

	parallelism := 1
	if job.Spec.Parallelism != nil {
		parallelism = int(*job.Spec.Parallelism)
	}

	image := ""
	if len(job.Spec.Template.Spec.Containers) > 0 {
		image = job.Spec.Template.Spec.Containers[0].Image
	}

	argsText := ""
	if len(job.Spec.Template.Spec.Containers) > 0 && len(job.Spec.Template.Spec.Containers[0].Args) > 2 {
		args := job.Spec.Template.Spec.Containers[0].Args
		argsText = strings.Join(args[2:], " ")
	}

	stage := "running"
	if job.Status.Succeeded > 0 {
		stage = "finished"
	} else if job.Status.Failed > 0 {
		stage = "failed"
	}

	return map[string]interface{}{
		"kind": "Job",
		"metadata": map[string]interface{}{
			"name":              job.Name,
			"namespace":         job.Namespace,
			"creationTimestamp": job.CreationTimestamp.Time.Format(time.RFC3339),
		},
		"spec": map[string]interface{}{
			"parallelism": parallelism,
			"script": map[string]interface{}{
				"configMap": map[string]interface{}{
					"name": cmName,
					"file": cmFile,
				},
			},
			"runner": map[string]interface{}{
				"image": image,
			},
			"arguments": argsText,
		},
		"status": map[string]interface{}{
			"stage": stage,
		},
	}
}

func (s *Server) mapCronJobToUI(cj *batchv1.CronJob) map[string]interface{} {
	cmName := ""
	cmFile := ""
	if len(cj.Spec.JobTemplate.Spec.Template.Spec.Volumes) > 0 {
		for _, vol := range cj.Spec.JobTemplate.Spec.Template.Spec.Volumes {
			if vol.ConfigMap != nil {
				cmName = vol.ConfigMap.Name
				break
			}
		}
	}
	if len(cj.Spec.JobTemplate.Spec.Template.Spec.Containers) > 0 && len(cj.Spec.JobTemplate.Spec.Template.Spec.Containers[0].Args) >= 2 {
		args := cj.Spec.JobTemplate.Spec.Template.Spec.Containers[0].Args
		if args[0] == "run" {
			cmFile = strings.TrimPrefix(args[1], "/script/")
		}
	}

	parallelism := 1
	if cj.Spec.JobTemplate.Spec.Parallelism != nil {
		parallelism = int(*cj.Spec.JobTemplate.Spec.Parallelism)
	}

	image := ""
	if len(cj.Spec.JobTemplate.Spec.Template.Spec.Containers) > 0 {
		image = cj.Spec.JobTemplate.Spec.Template.Spec.Containers[0].Image
	}

	argsText := ""
	if len(cj.Spec.JobTemplate.Spec.Template.Spec.Containers) > 0 && len(cj.Spec.JobTemplate.Spec.Template.Spec.Containers[0].Args) > 2 {
		args := cj.Spec.JobTemplate.Spec.Template.Spec.Containers[0].Args
		argsText = strings.Join(args[2:], " ")
	}

	return map[string]interface{}{
		"kind": "CronJob",
		"metadata": map[string]interface{}{
			"name":              cj.Name,
			"namespace":         cj.Namespace,
			"creationTimestamp": cj.CreationTimestamp.Time.Format(time.RFC3339),
		},
		"spec": map[string]interface{}{
			"parallelism": parallelism,
			"schedule":    cj.Spec.Schedule,
			"script": map[string]interface{}{
				"configMap": map[string]interface{}{
					"name": cmName,
					"file": cmFile,
				},
			},
			"runner": map[string]interface{}{
				"image": image,
			},
			"arguments": argsText,
		},
		"status": map[string]interface{}{
			"stage": "scheduled",
		},
	}
}

func (s *Server) handleGetConfigMap(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	name := r.PathValue("name")
	namespace := r.URL.Query().Get("namespace")
	if namespace == "" {
		namespace = "default"
	}

	client, isMock, err := s.getClusterClient(id)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	if isMock {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"name":"` + name + `","data":{"test.js":"// mock script content"}}`))
		return
	}

	cm, err := client.Clientset.CoreV1().ConfigMaps(namespace).Get(r.Context(), name, metav1.GetOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to get ConfigMap: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"name": cm.Name,
		"data": cm.Data,
	})
}

func (s *Server) handleUpdateConfigMap(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	name := r.PathValue("name")
	namespace := r.URL.Query().Get("namespace")
	if namespace == "" {
		namespace = "default"
	}

	client, isMock, err := s.getClusterClient(id)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	var body struct {
		Data map[string]string `json:"data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if isMock {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"success":true}`))
		return
	}

	cmClient := client.Clientset.CoreV1().ConfigMaps(namespace)
	cm, err := cmClient.Get(r.Context(), name, metav1.GetOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to find ConfigMap: %v"}`, err), http.StatusInternalServerError)
		return
	}

	if cm.Data == nil {
		cm.Data = make(map[string]string)
	}
	for k, v := range body.Data {
		cm.Data[k] = v
	}

	_, err = cmClient.Update(r.Context(), cm, metav1.UpdateOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to update ConfigMap: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}

func (s *Server) handleListConfigMaps(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	namespace := r.URL.Query().Get("namespace")
	if namespace == "all" {
		namespace = ""
	} else if namespace == "" {
		namespace = "default"
	}

	client, isMock, err := s.getClusterClient(id)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if isMock {
		w.Write([]byte(`[
			{
				"name": "mock-k6-script-1",
				"data": {
					"script.js": "import http from 'k6/http';\nimport { sleep } from 'k6';\n\nexport default function () {\n  http.get('https://test-api.k6.io');\n  sleep(1);\n}"
				}
			},
			{
				"name": "mock-k6-script-2",
				"data": {
					"main.js": "import http from 'k6/http';\nimport { check } from 'k6';\n\nexport default function () {\n  const res = http.get('https://httpbin.org/get');\n  check(res, {\n    'status is 200': (r) => r.status === 200,\n  });\n}"
				}
			}
		]`))
		return
	}

	cms, err := client.Clientset.CoreV1().ConfigMaps(namespace).List(r.Context(), metav1.ListOptions{
		LabelSelector: "k6s=enabled",
	})
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to list ConfigMaps: %v"}`, err), http.StatusInternalServerError)
		return
	}

	type CMItem struct {
		Name      string            `json:"name"`
		Namespace string            `json:"namespace"`
		Data      map[string]string `json:"data"`
	}
	result := make([]CMItem, 0)
	for _, cm := range cms.Items {
		result = append(result, CMItem{
			Name:      cm.Name,
			Namespace: cm.Namespace,
			Data:      cm.Data,
		})
	}

	json.NewEncoder(w).Encode(result)
}

func (s *Server) handleDeleteConfigMap(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	name := r.PathValue("name")
	namespace := r.URL.Query().Get("namespace")
	if namespace == "" {
		namespace = "default"
	}

	client, isMock, err := s.getClusterClient(id)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	if isMock {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"success":true}`))
		return
	}

	err = client.Clientset.CoreV1().ConfigMaps(namespace).Delete(r.Context(), name, metav1.DeleteOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to delete ConfigMap: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}

func (s *Server) handleCreateConfigMap(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	namespace := r.URL.Query().Get("namespace")
	if namespace == "" {
		namespace = "default"
	}

	client, isMock, err := s.getClusterClient(id)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	var body struct {
		Name          string `json:"name"`
		FileName      string `json:"fileName"`
		ScriptContent string `json:"scriptContent"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if body.Name == "" || body.FileName == "" {
		http.Error(w, `{"error":"name and fileName are required"}`, http.StatusBadRequest)
		return
	}

	if isMock {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"name":"` + body.Name + `","data":{"` + body.FileName + `":"` + body.ScriptContent + `"}}`))
		return
	}

	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      body.Name,
			Namespace: namespace,
			Labels: map[string]string{
				"k6s": "enabled",
			},
		},
		Data: map[string]string{
			body.FileName: body.ScriptContent,
		},
	}

	created, err := client.Clientset.CoreV1().ConfigMaps(namespace).Create(r.Context(), cm, metav1.CreateOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to create ConfigMap: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"name": created.Name,
		"data": created.Data,
	})
}

func (s *Server) handleListTestRuns(w http.ResponseWriter, r *http.Request) {
	runs, err := s.influxSvc.ListTestRuns(r.Context())
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(runs)
}

func (s *Server) checkSLATemplate(runID string) *database.K6Template {
	templates, err := s.db.GetTemplates()
	if err != nil {
		return nil
	}
	for _, t := range templates {
		if strings.Contains(runID, t.ScriptName) || strings.Contains(runID, t.Name) {
			return t
		}
	}
	return nil
}

func (s *Server) handleGetRunMetrics(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("run_id")
	metric := r.URL.Query().Get("metric") // e.g. "vus", "http_req_duration"
	if metric == "" {
		metric = "http_req_duration"
	}
	duration := r.URL.Query().Get("range")
	if duration == "" {
		duration = "1h"
	}
	start := r.URL.Query().Get("start")
	stop := r.URL.Query().Get("stop")
	cluster := r.URL.Query().Get("cluster")
	namespace := r.URL.Query().Get("namespace")

	w.Header().Set("Content-Type", "application/json")

	if s.config.InfluxURL == "" {
		http.Error(w, `{"error":"InfluxDB not configured"}`, http.StatusBadRequest)
		return
	}

	points, err := s.influxSvc.QueryK6Metrics(r.Context(), runID, metric, duration, start, stop, cluster, namespace)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to query metrics: %v"}`, err), http.StatusInternalServerError)
		return
	}

	// Check SLA thresholds in background
	go func(runID string, m string, pts []influx.TestMetricPoint) {
		tmpl := s.checkSLATemplate(runID)
		if tmpl == nil || tmpl.SLAThresholds == "" {
			return
		}
		var thresholds []struct {
			Metric   string  `json:"metric"`
			Operator string  `json:"operator"` // ">" or "<"
			Value    float64 `json:"value"`
		}
		if err := json.Unmarshal([]byte(tmpl.SLAThresholds), &thresholds); err != nil {
			return
		}

		for _, pt := range pts {
			for _, th := range thresholds {
				if th.Metric == m {
					violated := false
					if th.Operator == ">" && pt.Value > th.Value {
						violated = true
					} else if th.Operator == "<" && pt.Value < th.Value {
						violated = true
					}
					if violated {
						alert := &database.TestAlert{
							TestRunID: runID,
							Metric:    m,
							Threshold: fmt.Sprintf("%s %s %v", m, th.Operator, th.Value),
							Value:     pt.Value,
							Timestamp: pt.Timestamp,
						}
						_ = s.db.SaveAlert(alert)
					}
				}
			}
		}
	}(runID, metric, points)

	json.NewEncoder(w).Encode(points)
}

// --- Dynamic Mock Data Generation ---

func (s *Server) getMockK6CRDs(namespace string) []map[string]interface{} {
	ns := namespace
	if ns == "" {
		ns = "default"
	}
	return []map[string]interface{}{
		{
			"apiVersion": "k6.io/v1alpha1",
			"kind":       "K6",
			"metadata": map[string]interface{}{
				"name":              "k6-api-loadtest",
				"namespace":         ns,
				"creationTimestamp": time.Now().Add(-1 * time.Hour).Format(time.RFC3339),
			},
			"spec": map[string]interface{}{
				"parallelism": 3,
				"script": map[string]interface{}{
					"configMap": map[string]interface{}{
						"name": "k6-test-script",
						"file": "test.js",
					},
				},
				"runner": map[string]interface{}{
					"resources": map[string]interface{}{
						"limits": map[string]interface{}{
							"cpu":    "1000m",
							"memory": "1Gi",
						},
					},
				},
			},
			"status": map[string]interface{}{
				"stage": "running",
			},
		},
		{
			"apiVersion": "k6.io/v1alpha1",
			"kind":       "K6",
			"metadata": map[string]interface{}{
				"name":              "k6-spike-db-test",
				"namespace":         ns,
				"creationTimestamp": time.Now().Add(-5 * time.Hour).Format(time.RFC3339),
			},
			"spec": map[string]interface{}{
				"parallelism": 10,
				"script": map[string]interface{}{
					"configMap": map[string]interface{}{
						"name": "k6-db-spike-script",
						"file": "spike.js",
					},
				},
			},
			"status": map[string]interface{}{
				"stage": "finished",
			},
		},
	}
}



func (s *Server) handleGetInfluxDBConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	
	if os.Getenv("INFLUXDB_URL") != "" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"id":          "influx-env",
			"name":        "Environment Config",
			"version":     "v2",
			"url":         s.config.InfluxURL,
			"token":       s.config.InfluxToken,
			"org":         s.config.InfluxOrg,
			"bucket":      s.config.InfluxBucket,
			"username":    "",
			"password":    "",
			"method":      "POST",
			"is_active":   true,
			"env_defined": true,
		})
		return
	}

	if s.db != nil {
		active, err := s.db.GetActiveInfluxConfig()
		if err == nil && active != nil {
			// convert to map to add env_defined field
			m := map[string]interface{}{
				"id":          active.ID,
				"name":        active.Name,
				"version":     active.Version,
				"url":         active.URL,
				"token":       active.Token,
				"org":         active.Org,
				"bucket":      active.Bucket,
				"username":    active.Username,
				"password":    active.Password,
				"method":      active.Method,
				"is_active":   active.IsActive,
				"env_defined": false,
			}
			json.NewEncoder(w).Encode(m)
			return
		}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"version":     "v2",
		"url":         "",
		"token":       "",
		"org":         "",
		"bucket":      "",
		"username":    "",
		"password":    "",
		"method":      "POST",
		"env_defined": false,
	})
}

func (s *Server) handleSetInfluxDBConfig(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Version  string `json:"version"` // "v1" or "v2"
		URL      string `json:"url"`
		Token    string `json:"token"`
		Org      string `json:"org"`
		Bucket   string `json:"bucket"`
		Username string `json:"username"`
		Password string `json:"password"`
		Method   string `json:"method"` // "GET" or "POST"
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if body.URL == "" {
		http.Error(w, `{"error":"URL is required"}`, http.StatusBadRequest)
		return
	}

	if body.Version == "" {
		body.Version = "v2"
	}
	if body.Method == "" {
		body.Method = "POST"
	}

	// Verify connection before saving (warn but do not block)
	var warningMsg string
	err := influx.VerifyInfluxDBConnection(body.URL, body.Version, body.Token, body.Username, body.Password, body.Method)
	if err != nil {
		warningMsg = fmt.Sprintf("Connection check failed: %v", err)
	}

	// Persist to settings table (legacy support)
	if s.db != nil {
		_ = s.db.SaveSetting("influx_version", body.Version)
		_ = s.db.SaveSetting("influx_url", body.URL)
		_ = s.db.SaveSetting("influx_token", body.Token)
		_ = s.db.SaveSetting("influx_org", body.Org)
		_ = s.db.SaveSetting("influx_bucket", body.Bucket)
		_ = s.db.SaveSetting("influx_username", body.Username)
		_ = s.db.SaveSetting("influx_password", body.Password)
		_ = s.db.SaveSetting("influx_method", body.Method)

		// Create/Update "Default InfluxDB" configuration in named table as active
		active := &database.InfluxConfig{
			ID:        "influx-default",
			Name:      "Default InfluxDB",
			Version:   body.Version,
			URL:       body.URL,
			Token:     body.Token,
			Org:       body.Org,
			Bucket:    body.Bucket,
			Username:  body.Username,
			Password:  body.Password,
			Method:    body.Method,
			IsActive:  true,
			CreatedAt: time.Now(),
		}
		_ = s.db.SaveInfluxConfig(active)
		_ = s.db.SetActiveInfluxConfig(active.ID)
	}

	s.config.InfluxURL = body.URL
	s.config.InfluxToken = body.Token
	s.config.InfluxOrg = body.Org
	s.config.InfluxBucket = body.Bucket

	// Reinitialize InfluxDB service client
	s.influxSvc.Close()
	s.influxSvc = influx.NewMetricsService(body.Version, body.URL, body.Token, body.Org, body.Bucket, body.Username, body.Password, body.Method)

	w.Header().Set("Content-Type", "application/json")
	if warningMsg != "" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"warning": warningMsg,
		})
	} else {
		w.Write([]byte(`{"success":true}`))
	}
}

func (s *Server) handleTestInfluxDBConfig(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Version  string `json:"version"` // "v1" or "v2"
		URL      string `json:"url"`
		Token    string `json:"token"`
		Org      string `json:"org"`
		Bucket   string `json:"bucket"`
		Username string `json:"username"`
		Password string `json:"password"`
		Method   string `json:"method"` // "GET" or "POST"
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if body.URL == "" {
		http.Error(w, `{"error":"URL is required"}`, http.StatusBadRequest)
		return
	}

	if body.Version == "" {
		body.Version = "v2"
	}
	if body.Method == "" {
		body.Method = "POST"
	}

	err := influx.VerifyInfluxDBConnection(body.URL, body.Version, body.Token, body.Username, body.Password, body.Method)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"Connection check failed: %v"}`, err), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}

func (s *Server) handleListInfluxServers(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	list, err := s.db.GetInfluxConfigs()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to get influx configs: %v"}`, err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(list)
}

func (s *Server) handleCreateInfluxServer(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}

	var body struct {
		Name     string `json:"name"`
		Version  string `json:"version"`
		URL      string `json:"url"`
		Token    string `json:"token"`
		Org      string `json:"org"`
		Bucket   string `json:"bucket"`
		Username string `json:"username"`
		Password string `json:"password"`
		Method   string `json:"method"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if body.Name == "" || body.URL == "" || body.Bucket == "" {
		http.Error(w, `{"error":"missing required fields"}`, http.StatusBadRequest)
		return
	}

	if body.Version == "" {
		body.Version = "v2"
	}
	if body.Method == "" {
		body.Method = "POST"
	}

	// Verify connection first
	err := influx.VerifyInfluxDBConnection(body.URL, body.Version, body.Token, body.Username, body.Password, body.Method)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"Connection check failed: %v"}`, err), http.StatusBadRequest)
		return
	}

	id := fmt.Sprintf("influx-%d", time.Now().UnixNano())
	newConfig := &database.InfluxConfig{
		ID:        id,
		Name:      body.Name,
		Version:   body.Version,
		URL:       body.URL,
		Token:     body.Token,
		Org:       body.Org,
		Bucket:    body.Bucket,
		Username:  body.Username,
		Password:  body.Password,
		Method:    body.Method,
		IsActive:  false,
		CreatedAt: time.Now(),
	}

	list, _ := s.db.GetInfluxConfigs()
	if len(list) == 0 {
		newConfig.IsActive = true
	}

	if err := s.db.SaveInfluxConfig(newConfig); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to save server config: %v"}`, err), http.StatusInternalServerError)
		return
	}

	if newConfig.IsActive {
		_ = s.db.SetActiveInfluxConfig(newConfig.ID)
		s.influxSvc.Close()
		s.influxSvc = influx.NewMetricsService(newConfig.Version, newConfig.URL, newConfig.Token, newConfig.Org, newConfig.Bucket, newConfig.Username, newConfig.Password, newConfig.Method)
		
		s.config.InfluxURL = newConfig.URL
		s.config.InfluxToken = newConfig.Token
		s.config.InfluxOrg = newConfig.Org
		s.config.InfluxBucket = newConfig.Bucket
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(newConfig)
}

func (s *Server) handleUpdateInfluxServer(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"error":"missing ID"}`, http.StatusBadRequest)
		return
	}

	var body struct {
		Name     string `json:"name"`
		Version  string `json:"version"`
		URL      string `json:"url"`
		Token    string `json:"token"`
		Org      string `json:"org"`
		Bucket   string `json:"bucket"`
		Username string `json:"username"`
		Password string `json:"password"`
		Method   string `json:"method"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if body.Name == "" || body.URL == "" || body.Bucket == "" {
		http.Error(w, `{"error":"missing required fields"}`, http.StatusBadRequest)
		return
	}

	list, err := s.db.GetInfluxConfigs()
	if err != nil {
		http.Error(w, `{"error":"failed to check configs"}`, http.StatusInternalServerError)
		return
	}
	var existing *database.InfluxConfig
	for _, item := range list {
		if item.ID == id {
			existing = item
			break
		}
	}
	if existing == nil {
		http.Error(w, `{"error":"server configuration not found"}`, http.StatusNotFound)
		return
	}

	err = influx.VerifyInfluxDBConnection(body.URL, body.Version, body.Token, body.Username, body.Password, body.Method)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"Connection check failed: %v"}`, err), http.StatusBadRequest)
		return
	}

	updated := &database.InfluxConfig{
		ID:        id,
		Name:      body.Name,
		Version:   body.Version,
		URL:       body.URL,
		Token:     body.Token,
		Org:       body.Org,
		Bucket:    body.Bucket,
		Username:  body.Username,
		Password:  body.Password,
		Method:    body.Method,
		IsActive:  existing.IsActive,
		CreatedAt: existing.CreatedAt,
	}

	if err := s.db.SaveInfluxConfig(updated); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to save server config: %v"}`, err), http.StatusInternalServerError)
		return
	}

	if updated.IsActive {
		s.influxSvc.Close()
		s.influxSvc = influx.NewMetricsService(updated.Version, updated.URL, updated.Token, updated.Org, updated.Bucket, updated.Username, updated.Password, updated.Method)
		
		s.config.InfluxURL = updated.URL
		s.config.InfluxToken = updated.Token
		s.config.InfluxOrg = updated.Org
		s.config.InfluxBucket = updated.Bucket
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(updated)
}

func (s *Server) handleDeleteInfluxServer(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"error":"missing ID"}`, http.StatusBadRequest)
		return
	}

	list, _ := s.db.GetInfluxConfigs()
	var toDelete *database.InfluxConfig
	for _, item := range list {
		if item.ID == id {
			toDelete = item
			break
		}
	}

	if toDelete == nil {
		http.Error(w, `{"error":"server configuration not found"}`, http.StatusNotFound)
		return
	}

	if err := s.db.DeleteInfluxConfig(id); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to delete: %v"}`, err), http.StatusInternalServerError)
		return
	}

	if toDelete.IsActive {
		if s.influxSvc != nil {
			s.influxSvc.Close()
		}
		s.influxSvc = influx.NewMetricsService("v2", "", "", "", "", "", "", "POST")
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}

func (s *Server) handleActivateInfluxServer(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"error":"missing ID"}`, http.StatusBadRequest)
		return
	}

	if err := s.db.SetActiveInfluxConfig(id); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to activate config: %v"}`, err), http.StatusInternalServerError)
		return
	}

	active, err := s.db.GetActiveInfluxConfig()
	if err != nil || active == nil {
		http.Error(w, `{"error":"failed to load active config after activation"}`, http.StatusInternalServerError)
		return
	}

	s.influxSvc.Close()
	s.influxSvc = influx.NewMetricsService(active.Version, active.URL, active.Token, active.Org, active.Bucket, active.Username, active.Password, active.Method)

	s.config.InfluxURL = active.URL
	s.config.InfluxToken = active.Token
	s.config.InfluxOrg = active.Org
	s.config.InfluxBucket = active.Bucket

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(active)
}

func parseRegion(apiServerURL string) string {
	if strings.Contains(apiServerURL, ".eks.amazonaws.com") {
		parts := strings.Split(apiServerURL, ".")
		for i, part := range parts {
			if part == "eks" && i > 0 {
				return parts[i-1]
			}
		}
	}
	regions := []string{
		"us-east-1", "us-east-2", "us-west-1", "us-west-2",
		"eu-west-1", "eu-west-2", "eu-west-3", "eu-central-1",
		"ap-southeast-1", "ap-southeast-2", "ap-northeast-1", "ap-northeast-2",
		"sa-east-1", "ca-central-1",
	}
	for _, r := range regions {
		if strings.Contains(apiServerURL, r) {
			return r
		}
	}
	return "us-east-1"
}

func (s *Server) queryKubernetesVersion(clusterID string) string {
	client, _, err := s.getClusterClient(clusterID)
	if err != nil {
		return "v1.35.0-eks"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()

	var versionStr string
	done := make(chan struct{})
	go func() {
		info, err := client.Clientset.Discovery().ServerVersion()
		if err == nil && info != nil {
			versionStr = info.GitVersion
		}
		close(done)
	}()

	select {
	case <-done:
		if versionStr != "" {
			return versionStr
		}
	case <-ctx.Done():
	}

	return "v1.35.0-eks"
}

func (s *Server) checkK6OperatorWithClient(client *k8s.EKSClusterClient, namespaces []string) bool {
	// 1. Try Discovery API first with a larger timeout (5 seconds)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	type discoveryResult struct {
		resources *metav1.APIResourceList
		err       error
	}
	done := make(chan discoveryResult, 1)
	go func() {
		res, err := client.Clientset.Discovery().ServerResourcesForGroupVersion("k6.io/v1alpha1")
		done <- discoveryResult{resources: res, err: err}
	}()

	var res *metav1.APIResourceList
	var discErr error
	select {
	case r := <-done:
		res = r.resources
		discErr = r.err
	case <-ctx.Done():
		discErr = ctx.Err()
	}

	if res != nil && len(res.APIResources) > 0 {
		return true
	}
	if discErr == nil && res != nil {
		return true
	}

	// 2. Fallback to Dynamic client List checks in the specified namespaces
	// If the group is registered, dynamic list will return either success (nil error) or Forbidden error.
	// If the CRD is not registered, it will return a NotFound or "no matches for kind" error.
	for _, ns := range namespaces {
		dynamicCtx, dynamicCancel := context.WithTimeout(context.Background(), 3*time.Second)
		_, err1 := client.DynamicClient.Resource(k8s.GetK6TestRunGVR()).Namespace(ns).List(dynamicCtx, metav1.ListOptions{})
		dynamicCancel()

		if err1 == nil {
			return true
		}

		err1Str := err1.Error()
		if !apierrors.IsNotFound(err1) &&
			!strings.Contains(err1Str, "could not find the requested resource") &&
			!strings.Contains(err1Str, "no matches for kind") {
			return true
		}

		dynamicCtx2, dynamicCancel2 := context.WithTimeout(context.Background(), 3*time.Second)
		_, err2 := client.DynamicClient.Resource(k8s.GetK6GVR()).Namespace(ns).List(dynamicCtx2, metav1.ListOptions{})
		dynamicCancel2()

		if err2 == nil {
			return true
		}

		err2Str := err2.Error()
		if !apierrors.IsNotFound(err2) &&
			!strings.Contains(err2Str, "could not find the requested resource") &&
			!strings.Contains(err2Str, "no matches for kind") {
			return true
		}
	}

	return false
}

func (s *Server) checkK6OperatorInstalled(clusterID string) bool {
	client, isMock, err := s.getClusterClient(clusterID)
	if err != nil {
		return false
	}
	if isMock {
		return true
	}

	var namespaces []string
	if s.db != nil {
		clusters, err := s.db.GetClusters()
		if err == nil {
			for _, c := range clusters {
				if c.ID == clusterID {
					if c.Namespaces != "" {
						parts := strings.Split(c.Namespaces, ",")
						for _, p := range parts {
							t := strings.TrimSpace(p)
							if t != "" {
								namespaces = append(namespaces, t)
							}
						}
					}
					break
				}
			}
		}
	}
	namespaces = append(namespaces, "k6s", "default")

	return s.checkK6OperatorWithClient(client, namespaces)
}


func (s *Server) handleListNamespaces(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	// If this cluster has static allowed namespaces defined, return them directly
	var clusterConfig *ClusterConfig
	if s.db != nil {
		clusters, err := s.db.GetClusters()
		if err == nil {
			for _, c := range clusters {
				if c.ID == id {
					clusterConfig = c
					break
				}
			}
		}
	}

	if clusterConfig != nil && clusterConfig.Namespaces != "" {
		parts := strings.Split(clusterConfig.Namespaces, ",")
		var cleaned []string
		for _, p := range parts {
			trimmed := strings.TrimSpace(p)
			if trimmed != "" {
				cleaned = append(cleaned, trimmed)
			}
		}
		if len(cleaned) > 0 {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(cleaned)
			return
		}
	}

	client, isMock, err := s.getClusterClient(id)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if isMock {
		json.NewEncoder(w).Encode([]string{"default", "k6-test", "testing"})
		return
	}

	nsList, err := client.Clientset.CoreV1().Namespaces().List(r.Context(), metav1.ListOptions{
		LabelSelector: "k6s=enabled",
	})
	if err != nil {
		// Fallback to default if there is a permission error or other issue listing namespaces
		json.NewEncoder(w).Encode([]string{"default"})
		return
	}

	names := make([]string, 0)
	for _, ns := range nsList.Items {
		names = append(names, ns.Name)
	}

	json.NewEncoder(w).Encode(names)
}

func (s *Server) handleListLocalContexts(w http.ResponseWriter, r *http.Request) {
	contexts, current, err := k8s.GetLocalContexts()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to get local contexts: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"contexts":        contexts,
		"current_context": current,
	})
}

func (s *Server) handleGetOperatorStatus(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	clusters, err := s.db.GetClusters()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to get clusters: %v"}`, err), http.StatusInternalServerError)
		return
	}

	if len(clusters) == 0 {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ready","accessible_count":0,"total_count":0}`))
		return
	}

	totalCount := len(clusters)
	accessibleCount := 0
	deployedCount := 0

	for _, c := range clusters {
		client, isMock, err := s.getClusterClient(c.ID)
		if err != nil {
			continue
		}

		if isMock {
			accessibleCount++
			deployedCount++
			continue
		}

		// Try to query discovery API server version as a basic connection test
		_, cancel := context.WithTimeout(r.Context(), 1500*time.Millisecond)
		_, connErr := client.Clientset.Discovery().ServerVersion()
		cancel()

		if connErr != nil {
			continue
		}

		accessibleCount++

		// Check if K6 Operator CRD group is registered
		var namespaces []string
		if c.Namespaces != "" {
			parts := strings.Split(c.Namespaces, ",")
			for _, p := range parts {
				t := strings.TrimSpace(p)
				if t != "" {
					namespaces = append(namespaces, t)
				}
			}
		}
		namespaces = append(namespaces, "k6s", "default")

		if s.checkK6OperatorWithClient(client, namespaces) {
			deployedCount++
		}
	}

	status := "ready"
	if accessibleCount == 0 {
		status = "unavailable" // Red: all not accessible
	} else if deployedCount < totalCount {
		status = "degraded" // Yellow: not all have k6s deployed (or some not accessible)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":           status,
		"accessible_count": accessibleCount,
		"deployed_count":   deployedCount,
		"total_count":      totalCount,
	})
}

func (s *Server) handleGetActiveTests(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	clusters, err := s.db.GetClusters()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to get clusters: %v"}`, err), http.StatusInternalServerError)
		return
	}

	activeCount := 0
	firstActiveName := "None"

	for _, c := range clusters {
		client, isMock, err := s.getClusterClient(c.ID)
		if err != nil {
			continue
		}

		namespaces := []string{"default"}
		if c.Namespaces != "" {
			parts := strings.Split(c.Namespaces, ",")
			var cleaned []string
			for _, p := range parts {
				t := strings.TrimSpace(p)
				if t != "" {
					cleaned = append(cleaned, t)
				}
			}
			if len(cleaned) > 0 {
				namespaces = cleaned
			}
		}

		if isMock {
			for _, ns := range namespaces {
				mockCRDs := s.getMockK6CRDs(ns)
				for _, item := range mockCRDs {
					status, ok := item["status"].(map[string]interface{})
					if ok {
						stage, _ := status["stage"].(string)
						if strings.ToLower(stage) == "running" {
							activeCount++
							if firstActiveName == "None" {
								metadata, _ := item["metadata"].(map[string]interface{})
								if metadata != nil {
									name, _ := metadata["name"].(string)
									if name != "" {
										firstActiveName = name
									}
								}
							}
						}
					}
				}
			}
			continue
		}

		for _, ns := range namespaces {
			ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
			items, listErr := client.ListK6CustomResources(ctx, ns)
			cancel()

			if listErr != nil {
				continue
			}

			for _, item := range items {
				statusObj, found, _ := unstructured.NestedMap(item.Object, "status")
				if found {
					stage, _ := statusObj["stage"].(string)
					if strings.ToLower(stage) == "running" {
						activeCount++
						if firstActiveName == "None" {
							firstActiveName = item.GetName()
						}
					}
				}
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"active_count": activeCount,
		"first_active": firstActiveName,
	})
}

func (s *Server) handleListTemplates(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	list, err := s.db.GetTemplates()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to get templates: %v"}`, err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(list)
}

func (s *Server) handleCreateTemplate(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}

	var body struct {
		Name          string `json:"name"`
		Parallelism   int    `json:"parallelism"`
		ScriptName    string `json:"script_name"`
		ScriptFile    string `json:"script_file"`
		CPULimit      string `json:"cpu_limit"`
		MemLimit      string `json:"mem_limit"`
		ScriptContent string `json:"script_content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if body.Name == "" || body.ScriptName == "" || body.ScriptFile == "" || body.ScriptContent == "" {
		http.Error(w, `{"error":"missing required fields"}`, http.StatusBadRequest)
		return
	}

	id := fmt.Sprintf("tmpl-%d", time.Now().UnixNano())
	newTemplate := &database.K6Template{
		ID:            id,
		Name:          body.Name,
		Parallelism:   body.Parallelism,
		ScriptName:    body.ScriptName,
		ScriptFile:    body.ScriptFile,
		CPULimit:      body.CPULimit,
		MemLimit:      body.MemLimit,
		ScriptContent: body.ScriptContent,
		CreatedAt:     time.Now(),
	}

	if err := s.db.SaveTemplate(newTemplate); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to save template: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(newTemplate)
}

func (s *Server) handleUpdateTemplate(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"error":"missing ID"}`, http.StatusBadRequest)
		return
	}

	var body struct {
		Name          string `json:"name"`
		Parallelism   int    `json:"parallelism"`
		ScriptName    string `json:"script_name"`
		ScriptFile    string `json:"script_file"`
		CPULimit      string `json:"cpu_limit"`
		MemLimit      string `json:"mem_limit"`
		ScriptContent string `json:"script_content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if body.Name == "" || body.ScriptName == "" || body.ScriptFile == "" || body.ScriptContent == "" {
		http.Error(w, `{"error":"missing required fields"}`, http.StatusBadRequest)
		return
	}

	updatedTemplate := &database.K6Template{
		ID:            id,
		Name:          body.Name,
		Parallelism:   body.Parallelism,
		ScriptName:    body.ScriptName,
		ScriptFile:    body.ScriptFile,
		CPULimit:      body.CPULimit,
		MemLimit:      body.MemLimit,
		ScriptContent: body.ScriptContent,
		CreatedAt:     time.Now(),
	}

	if err := s.db.SaveTemplate(updatedTemplate); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to update template: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(updatedTemplate)
}

func (s *Server) handleDeleteTemplate(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"error":"missing ID"}`, http.StatusBadRequest)
		return
	}

	if err := s.db.DeleteTemplate(id); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to delete template: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	list, err := s.db.GetUsers()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to get users: %v"}`, err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(list)
}

func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}

	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if body.Username == "" || body.Password == "" || body.Role == "" {
		http.Error(w, `{"error":"missing required fields"}`, http.StatusBadRequest)
		return
	}

	salt, err := auth.GenerateSalt()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to generate salt: %v"}`, err), http.StatusInternalServerError)
		return
	}

	passwordHash := auth.HashPassword(body.Password, salt)

	newUser := &database.User{
		Username:     body.Username,
		PasswordHash: passwordHash,
		Salt:         salt,
		Role:         body.Role,
		CreatedAt:    time.Now(),
	}

	if err := s.db.SaveUser(newUser); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to save user: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(newUser)
}

func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	username := r.PathValue("username")
	if username == "" {
		http.Error(w, `{"error":"missing username"}`, http.StatusBadRequest)
		return
	}

	if username == "admin" {
		http.Error(w, `{"error":"cannot delete main administrator account"}`, http.StatusBadRequest)
		return
	}

	if err := s.db.DeleteUser(username); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to delete user: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}

func (s *Server) handleGetSSOConfig(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	c, err := s.db.GetSSOConfig()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to get sso config: %v"}`, err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(c)
}

func (s *Server) handleSetSSOConfig(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	var body database.SSOConfig
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if body.ClientSecret == "" {
		existing, err := s.db.GetSSOConfig()
		if err == nil && existing != nil && existing.ClientSecret != "" {
			body.ClientSecret = existing.ClientSecret
		}
	}

	if body.Enabled && (body.IssuerURL == "" || body.ClientID == "" || body.ClientSecret == "" || body.RedirectURI == "") {
		http.Error(w, `{"error":"all SSO fields are required when enabling"}`, http.StatusBadRequest)
		return
	}

	if err := s.db.SaveSSOConfig(&body); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to save sso config: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(body)
}

func (s *Server) handleGetSSOStatus(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"enabled":false}`))
		return
	}
	c, err := s.db.GetSSOConfig()
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"enabled":false}`))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"enabled": c.Enabled, "name": c.Name})
}

type OpenIDConfig struct {
	AuthorizationEndpoint string `json:"authorization_endpoint"`
	TokenEndpoint         string `json:"token_endpoint"`
	UserinfoEndpoint      string `json:"userinfo_endpoint"`
}

func getOpenIDConfig(issuerURL string) (*OpenIDConfig, error) {
	wellKnown := strings.TrimSuffix(issuerURL, "/") + "/.well-known/openid-configuration"
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(wellKnown)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status %d", resp.StatusCode)
	}

	var cfg OpenIDConfig
	if err := json.NewDecoder(resp.Body).Decode(&cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

func (s *Server) handleGetSSOAuthorizeURL(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	c, err := s.db.GetSSOConfig()
	if err != nil || !c.Enabled {
		http.Error(w, `{"error":"SSO not configured or disabled"}`, http.StatusBadRequest)
		return
	}

	oidcCfg, err := getOpenIDConfig(c.IssuerURL)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"Failed to fetch OpenID metadata: %v"}`, err), http.StatusInternalServerError)
		return
	}

	state := fmt.Sprintf("%d", time.Now().UnixNano())
	authURL := fmt.Sprintf("%s?response_type=code&client_id=%s&redirect_uri=%s&scope=openid+profile+email&state=%s",
		oidcCfg.AuthorizationEndpoint,
		c.ClientID,
		c.RedirectURI,
		state,
	)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"url": authURL})
}

func (s *Server) handleSSOCallbackExchange(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	c, err := s.db.GetSSOConfig()
	if err != nil || !c.Enabled {
		http.Error(w, `{"error":"SSO disabled"}`, http.StatusBadRequest)
		return
	}

	var body struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}

	if body.Code == "" {
		http.Error(w, `{"error":"missing auth code"}`, http.StatusBadRequest)
		return
	}

	oidcCfg, err := getOpenIDConfig(c.IssuerURL)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to get OIDC configuration: %v"}`, err), http.StatusInternalServerError)
		return
	}

	exchangeClient := &http.Client{Timeout: 10 * time.Second}
	data := fmt.Sprintf("grant_type=authorization_code&code=%s&client_id=%s&client_secret=%s&redirect_uri=%s",
		body.Code,
		c.ClientID,
		c.ClientSecret,
		c.RedirectURI,
	)
	req, err := http.NewRequest("POST", oidcCfg.TokenEndpoint, strings.NewReader(data))
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to construct token request: %v"}`, err), http.StatusInternalServerError)
		return
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := exchangeClient.Do(req)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to perform token exchange: %v"}`, err), http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		http.Error(w, fmt.Sprintf(`{"error":"token exchange failed with status %d"}`, resp.StatusCode), http.StatusBadRequest)
		return
	}

	var tokenResponse struct {
		AccessToken string `json:"access_token"`
		IDToken     string `json:"id_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tokenResponse); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to decode token response: %v"}`, err), http.StatusInternalServerError)
		return
	}

	profileReq, err := http.NewRequest("GET", oidcCfg.UserinfoEndpoint, nil)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to construct userinfo request: %v"}`, err), http.StatusInternalServerError)
		return
	}
	profileReq.Header.Set("Authorization", "Bearer "+tokenResponse.AccessToken)

	profileResp, err := exchangeClient.Do(profileReq)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to fetch user info: %v"}`, err), http.StatusInternalServerError)
		return
	}
	defer profileResp.Body.Close()

	if profileResp.StatusCode != http.StatusOK {
		http.Error(w, fmt.Sprintf(`{"error":"userinfo request failed with status %d"}`, profileResp.StatusCode), http.StatusBadRequest)
		return
	}

	var userProfile struct {
		Name          string   `json:"name"`
		Email         string   `json:"email"`
		PreferredName string   `json:"preferred_username"`
		Groups        []string `json:"groups"`
	}
	if err := json.NewDecoder(profileResp.Body).Decode(&userProfile); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to decode user profile: %v"}`, err), http.StatusInternalServerError)
		return
	}

	username := userProfile.Email
	if username == "" {
		username = userProfile.PreferredName
	}
	if username == "" {
		username = userProfile.Name
	}

	if tokenResponse.IDToken != "" {
		parts := strings.Split(tokenResponse.IDToken, ".")
		if len(parts) >= 2 {
			payloadSegment := parts[1]
			if payloadBytes, err := base64.RawURLEncoding.DecodeString(payloadSegment); err == nil {
				var idTokenClaims struct {
					Groups []string `json:"groups"`
				}
				if err := json.Unmarshal(payloadBytes, &idTokenClaims); err == nil {
					for _, newG := range idTokenClaims.Groups {
						exists := false
						for _, oldG := range userProfile.Groups {
							if oldG == newG {
								exists = true
								break
							}
						}
						if !exists {
							userProfile.Groups = append(userProfile.Groups, newG)
						}
					}
				}
			}
		}
	}

	adminGroupsConfig := c.AdminGroups
	editorGroupsConfig := c.EditorGroups

	adminGroupList := []string{}
	for _, g := range strings.Split(adminGroupsConfig, ",") {
		gTrimmed := strings.ToLower(strings.TrimSpace(g))
		if gTrimmed != "" {
			adminGroupList = append(adminGroupList, gTrimmed)
		}
	}
	editorGroupList := []string{}
	for _, g := range strings.Split(editorGroupsConfig, ",") {
		gTrimmed := strings.ToLower(strings.TrimSpace(g))
		if gTrimmed != "" {
			editorGroupList = append(editorGroupList, gTrimmed)
		}
	}

	role := "viewer"
	hasAdminGroup := false
	hasEditorGroup := false

	for _, g := range userProfile.Groups {
		gLower := strings.ToLower(strings.TrimSpace(g))
		
		for _, adminG := range adminGroupList {
			if gLower == adminG {
				hasAdminGroup = true
			}
		}
		if strings.Contains(gLower, "admin") {
			hasAdminGroup = true
		}

		for _, editorG := range editorGroupList {
			if gLower == editorG {
				hasEditorGroup = true
			}
		}
	}

	if hasAdminGroup || strings.Contains(strings.ToLower(username), "admin") {
		role = "administrator"
	} else if hasEditorGroup {
		role = "editor"
	}

	if s.db != nil {
		existingUser, err := s.db.GetUser(username)
		if err == nil {
			if existingUser == nil {
				newUser := &database.User{
					Username:     username,
					PasswordHash: "",
					Salt:         "sso_user",
					Role:         role,
					CreatedAt:    time.Now(),
				}
				_ = s.db.SaveUser(newUser)
			} else if existingUser.Role != role {
				existingUser.Role = role
				_ = s.db.SaveUser(existingUser)
			}
		}
	}

	sessionToken, err := s.authSvc.GenerateToken(username, role)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to generate session: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"token":    sessionToken,
		"username": username,
		"role":     role,
	})
}

func (s *Server) handleListAPITokens(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	tokens, err := s.db.ListAPITokens()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to list API tokens: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tokens)
}

func (s *Server) handleGenerateAPIToken(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}

	var body struct {
		Name       string `json:"name"`
		Role       string `json:"role"`
		ExpiryDays int    `json:"expiry_days"` // 0 means Never, otherwise positive days
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if body.Name == "" {
		http.Error(w, `{"error":"name is required"}`, http.StatusBadRequest)
		return
	}
	if body.Role != "administrator" && body.Role != "admin" && body.Role != "editor" && body.Role != "edit" && body.Role != "viewer" {
		http.Error(w, `{"error":"invalid role"}`, http.StatusBadRequest)
		return
	}

	// Generate raw token starting with stratum_tok_
	randomBytes := make([]byte, 24)
	if _, err := rand.Read(randomBytes); err != nil {
		http.Error(w, `{"error":"failed to generate random bytes"}`, http.StatusInternalServerError)
		return
	}
	rawToken := "stratum_tok_" + hex.EncodeToString(randomBytes)

	// Hash the token using SHA-256 for storage
	hasher := sha256.New()
	hasher.Write([]byte(rawToken))
	tokenHash := hex.EncodeToString(hasher.Sum(nil))

	var expiresAt *time.Time
	if body.ExpiryDays > 0 {
		exp := time.Now().AddDate(0, 0, body.ExpiryDays)
		expiresAt = &exp
	}

	if err := s.db.SaveAPIToken(tokenHash, body.Name, body.Role, expiresAt); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to save API token: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"token":      rawToken,
		"token_hash": tokenHash,
		"name":       body.Name,
		"role":       body.Role,
		"expires_at": expiresAt,
	})
}

func (s *Server) handleDeleteAPIToken(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	hash := r.PathValue("hash")
	if hash == "" {
		http.Error(w, `{"error":"missing token hash"}`, http.StatusBadRequest)
		return
	}

	if err := s.db.DeleteAPIToken(hash); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to delete API token: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}

func (s *Server) handleRelaunchCRD(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	name := r.PathValue("name")
	namespace := r.URL.Query().Get("namespace")
	if namespace == "" {
		namespace = "default"
	}

	client, isMock, err := s.getClusterClient(id)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	if isMock {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"success":true}`))
		return
	}

	oldObj, err := client.GetK6CustomResource(r.Context(), namespace, name)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to fetch existing CRD: %v"}`, err), http.StatusInternalServerError)
		return
	}

	newObj := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": oldObj.GetAPIVersion(),
			"kind":       oldObj.GetKind(),
			"metadata": map[string]interface{}{
				"name":      oldObj.GetName(),
				"namespace": oldObj.GetNamespace(),
			},
		},
	}
	if labels := oldObj.GetLabels(); labels != nil {
		newObj.SetLabels(labels)
	}
	if spec, ok := oldObj.Object["spec"]; ok {
		newObj.Object["spec"] = spec
	}

	err = client.DeleteK6CustomResource(r.Context(), namespace, name)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to delete existing CRD: %v"}`, err), http.StatusInternalServerError)
		return
	}

	time.Sleep(1500 * time.Millisecond)

	created, err := client.CreateK6CustomResource(r.Context(), namespace, newObj)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to recreate CRD: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(created.Object)
}

func (s *Server) handleListSchedules(w http.ResponseWriter, r *http.Request) {
	list, err := s.db.GetSchedules()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to get schedules: %v"}`, err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(list)
}

func (s *Server) handleCreateSchedule(w http.ResponseWriter, r *http.Request) {
	var sched database.TestSchedule
	if err := json.NewDecoder(r.Body).Decode(&sched); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if sched.Name == "" || sched.ClusterID == "" || sched.Namespace == "" || sched.TemplateID == "" {
		http.Error(w, `{"error":"all fields except cron expression are required"}`, http.StatusBadRequest)
		return
	}

	isScheduled := sched.CronExpression != ""
	if isScheduled {
		if len(strings.Fields(sched.CronExpression)) != 5 {
			http.Error(w, `{"error":"invalid cron expression (must be exactly 5 fields)"}`, http.StatusBadRequest)
			return
		}
	}

	sched.CreatedAt = time.Now()
	if err := s.db.SaveSchedule(&sched); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to save schedule: %v"}`, err), http.StatusInternalServerError)
		return
	}

	// Deploy to EKS natively if not mock
	client, isMock, err := s.getClusterClient(sched.ClusterID)
	if err == nil && !isMock {
		// Clean schedule name to be dns-compliant
		dnsName := strings.ToLower(sched.Name)
		dnsName = strings.ReplaceAll(dnsName, " ", "-")
		// Remove non-alphanumeric/hyphen characters
		var cleaned []rune
		for _, r := range dnsName {
			if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
				cleaned = append(cleaned, r)
			}
		}
		dnsName = string(cleaned)
		if len(dnsName) > 52 {
			dnsName = dnsName[:52]
		}
		dnsName = strings.Trim(dnsName, "-")

		template, tempErr := s.db.GetTemplate(sched.TemplateID)
		if tempErr == nil && template != nil {
			configMapName := "cm-" + dnsName
			scriptFile := template.ScriptFile
			if scriptFile == "" {
				scriptFile = "script.js"
			}

			// 1. Create ConfigMap if script is provided
			if template.ScriptContent != "" {
				cm := &corev1.ConfigMap{
					ObjectMeta: metav1.ObjectMeta{
						Name:      configMapName,
						Namespace: sched.Namespace,
						Labels: map[string]string{
							"k6s": "enabled",
						},
					},
					Data: map[string]string{
						scriptFile: template.ScriptContent,
					},
				}
				cmClient := client.Clientset.CoreV1().ConfigMaps(sched.Namespace)
				_, getErr := cmClient.Get(r.Context(), configMapName, metav1.GetOptions{})
				if getErr != nil {
					_, _ = cmClient.Create(r.Context(), cm, metav1.CreateOptions{})
				} else {
					_, _ = cmClient.Update(r.Context(), cm, metav1.UpdateOptions{})
				}
			} else if template.ScriptName != "" {
				configMapName = template.ScriptName
			}

			// 2. Resource limits
			var limits corev1.ResourceList
			if template.CPULimit != "" || template.MemLimit != "" {
				limits = make(corev1.ResourceList)
				if template.CPULimit != "" {
					if q, err := resource.ParseQuantity(template.CPULimit); err == nil {
						limits[corev1.ResourceCPU] = q
					}
				}
				if template.MemLimit != "" {
					if q, err := resource.ParseQuantity(template.MemLimit); err == nil {
						limits[corev1.ResourceMemory] = q
					}
				}
			}
			resources := corev1.ResourceRequirements{}
			if len(limits) > 0 {
				resources.Limits = limits
			}

			// 3. Parallelism
			parallelismVal := int32(template.Parallelism)
			if parallelismVal <= 0 {
				parallelismVal = 1
			}

			// 4. Runner Image
			image := "grafana/k6:latest"

			// 5. Arguments
			var runArgs []string
			runArgs = append(runArgs, "run", "/script/"+scriptFile)
			jobSpec := batchv1.JobSpec{
				Parallelism: &parallelismVal,
				Template: corev1.PodTemplateSpec{
					ObjectMeta: metav1.ObjectMeta{
						Labels: map[string]string{
							"k6s": "enabled",
						},
					},
					Spec: corev1.PodSpec{
						RestartPolicy: corev1.RestartPolicyNever,
						Containers: []corev1.Container{
							{
								Name:      "k6-runner",
								Image:     image,
								Args:      runArgs,
								Resources: resources,
								VolumeMounts: []corev1.VolumeMount{
									{
										Name:      "script-volume",
										MountPath: "/script",
									},
								},
							},
						},
						Volumes: []corev1.Volume{
							{
								Name: "script-volume",
								VolumeSource: corev1.VolumeSource{
									ConfigMap: &corev1.ConfigMapVolumeSource{
										LocalObjectReference: corev1.LocalObjectReference{
											Name: configMapName,
										},
									},
								},
							},
						},
					},
				},
			}

			if isScheduled {
				suspendVal := !sched.Active
				cronJob := &batchv1.CronJob{
					TypeMeta: metav1.TypeMeta{
						APIVersion: "batch/v1",
						Kind:       "CronJob",
					},
					ObjectMeta: metav1.ObjectMeta{
						Name:      dnsName,
						Namespace: sched.Namespace,
						Labels: map[string]string{
							"k6s": "enabled",
						},
					},
					Spec: batchv1.CronJobSpec{
						Schedule:          sched.CronExpression,
						ConcurrencyPolicy: batchv1.ForbidConcurrent,
						Suspend:           &suspendVal,
						JobTemplate: batchv1.JobTemplateSpec{
							ObjectMeta: metav1.ObjectMeta{
								Labels: map[string]string{
									"k6s": "enabled",
								},
							},
							Spec: jobSpec,
						},
					},
				}
				_, _ = client.Clientset.BatchV1().CronJobs(sched.Namespace).Create(r.Context(), cronJob, metav1.CreateOptions{})
			} else {
				job := &batchv1.Job{
					TypeMeta: metav1.TypeMeta{
						APIVersion: "batch/v1",
						Kind:       "Job",
					},
					ObjectMeta: metav1.ObjectMeta{
						Name:      dnsName,
						Namespace: sched.Namespace,
						Labels: map[string]string{
							"k6s": "enabled",
						},
					},
					Spec: jobSpec,
				}
				_, _ = client.Clientset.BatchV1().Jobs(sched.Namespace).Create(r.Context(), job, metav1.CreateOptions{})
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sched)
}

func (s *Server) handleDeleteSchedule(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, `{"error":"invalid schedule id"}`, http.StatusBadRequest)
		return
	}

	sched, err := s.db.GetSchedule(id)
	if err == nil && sched != nil {
		client, isMock, err := s.getClusterClient(sched.ClusterID)
		if err == nil && !isMock {
			dnsName := strings.ToLower(sched.Name)
			dnsName = strings.ReplaceAll(dnsName, " ", "-")
			var cleaned []rune
			for _, r := range dnsName {
				if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
					cleaned = append(cleaned, r)
				}
			}
			dnsName = string(cleaned)
			if len(dnsName) > 52 {
				dnsName = dnsName[:52]
			}
			dnsName = strings.Trim(dnsName, "-")

			_ = client.Clientset.BatchV1().CronJobs(sched.Namespace).Delete(r.Context(), dnsName, metav1.DeleteOptions{})
			_ = client.Clientset.BatchV1().Jobs(sched.Namespace).Delete(r.Context(), dnsName, metav1.DeleteOptions{})
		}
	}

	if err := s.db.DeleteSchedule(id); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to delete schedule: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}

func (s *Server) handleRunSchedule(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, `{"error":"invalid schedule id"}`, http.StatusBadRequest)
		return
	}

	sched, err := s.db.GetSchedule(id)
	if err != nil || sched == nil {
		http.Error(w, `{"error":"schedule not found"}`, http.StatusNotFound)
		return
	}

	client, isMock, err := s.getClusterClient(sched.ClusterID)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to get cluster client: %v"}`, err), http.StatusInternalServerError)
		return
	}

	if isMock {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"success":true}`))
		return
	}

	// Clean schedule name to be dns-compliant and unique
	dnsName := fmt.Sprintf("manual-%s-%d", strings.ToLower(sched.Name), time.Now().Unix())
	dnsName = strings.ReplaceAll(dnsName, " ", "-")
	var cleaned []rune
	for _, r := range dnsName {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			cleaned = append(cleaned, r)
		}
	}
	dnsName = string(cleaned)
	if len(dnsName) > 52 {
		dnsName = dnsName[:52]
	}
	dnsName = strings.Trim(dnsName, "-")

	template, tempErr := s.db.GetTemplate(sched.TemplateID)
	if tempErr != nil || template == nil {
		http.Error(w, `{"error":"template not found"}`, http.StatusNotFound)
		return
	}

	configMapName := "cm-" + dnsName
	scriptFile := template.ScriptFile
	if scriptFile == "" {
		scriptFile = "script.js"
	}

	// 1. Create ConfigMap if script is provided
	if template.ScriptContent != "" {
		cm := &corev1.ConfigMap{
			ObjectMeta: metav1.ObjectMeta{
				Name:      configMapName,
				Namespace: sched.Namespace,
				Labels: map[string]string{
					"k6s": "enabled",
				},
			},
			Data: map[string]string{
				scriptFile: template.ScriptContent,
			},
		}
		cmClient := client.Clientset.CoreV1().ConfigMaps(sched.Namespace)
		_, getErr := cmClient.Get(r.Context(), configMapName, metav1.GetOptions{})
		if getErr != nil {
			_, err = cmClient.Create(r.Context(), cm, metav1.CreateOptions{})
			if err != nil {
				http.Error(w, fmt.Sprintf(`{"error":"failed to create ConfigMap: %v"}`, err), http.StatusInternalServerError)
				return
			}
		}
	} else if template.ScriptName != "" {
		configMapName = template.ScriptName
	}

	// 2. Resource limits
	var limits corev1.ResourceList
	if template.CPULimit != "" || template.MemLimit != "" {
		limits = make(corev1.ResourceList)
		if template.CPULimit != "" {
			if q, err := resource.ParseQuantity(template.CPULimit); err == nil {
				limits[corev1.ResourceCPU] = q
			}
		}
		if template.MemLimit != "" {
			if q, err := resource.ParseQuantity(template.MemLimit); err == nil {
				limits[corev1.ResourceMemory] = q
			}
		}
	}
	resources := corev1.ResourceRequirements{}
	if len(limits) > 0 {
		resources.Limits = limits
	}

	// 3. Parallelism
	parallelismVal := int32(template.Parallelism)
	if parallelismVal <= 0 {
		parallelismVal = 1
	}

	// 4. Runner Image
	image := "grafana/k6:latest"

	// 5. Arguments
	var runArgs []string
	runArgs = append(runArgs, "run", "/script/"+scriptFile)
	job := &batchv1.Job{
		TypeMeta: metav1.TypeMeta{
			APIVersion: "batch/v1",
			Kind:       "Job",
		},
		ObjectMeta: metav1.ObjectMeta{
			Name:      dnsName,
			Namespace: sched.Namespace,
			Labels: map[string]string{
				"k6s": "enabled",
			},
		},
		Spec: batchv1.JobSpec{
			Parallelism: &parallelismVal,
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						"k6s": "enabled",
					},
				},
				Spec: corev1.PodSpec{
					RestartPolicy: corev1.RestartPolicyNever,
					Containers: []corev1.Container{
						{
							Name:      "k6-runner",
							Image:     image,
							Args:      runArgs,
							Resources: resources,
							VolumeMounts: []corev1.VolumeMount{
								{
									Name:      "script-volume",
									MountPath: "/script",
								},
							},
						},
					},
					Volumes: []corev1.Volume{
						{
							Name: "script-volume",
							VolumeSource: corev1.VolumeSource{
								ConfigMap: &corev1.ConfigMapVolumeSource{
									LocalObjectReference: corev1.LocalObjectReference{
										Name: configMapName,
									},
								},
							},
						},
					},
				},
			},
		},
	}

	_, err = client.Clientset.BatchV1().Jobs(sched.Namespace).Create(r.Context(), job, metav1.CreateOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to create Job: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}

func (s *Server) handleToggleSchedule(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, `{"error":"invalid schedule id"}`, http.StatusBadRequest)
		return
	}

	sched, err := s.db.GetSchedule(id)
	if err != nil || sched == nil {
		http.Error(w, `{"error":"schedule not found"}`, http.StatusNotFound)
		return
	}

	sched.Active = !sched.Active
	if err := s.db.SaveSchedule(sched); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to update schedule: %v"}`, err), http.StatusInternalServerError)
		return
	}

	// If it is a CronJob (i.e., has a CronExpression), update Spec.Suspend in Kubernetes
	if sched.CronExpression != "" {
		client, isMock, err := s.getClusterClient(sched.ClusterID)
		if err == nil && !isMock {
			dnsName := strings.ToLower(sched.Name)
			dnsName = strings.ReplaceAll(dnsName, " ", "-")
			var cleaned []rune
			for _, r := range dnsName {
				if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
					cleaned = append(cleaned, r)
				}
			}
			dnsName = string(cleaned)
			if len(dnsName) > 52 {
				dnsName = dnsName[:52]
			}
			dnsName = strings.Trim(dnsName, "-")

			cronJobClient := client.Clientset.BatchV1().CronJobs(sched.Namespace)
			cronJob, getErr := cronJobClient.Get(r.Context(), dnsName, metav1.GetOptions{})
			if getErr == nil && cronJob != nil {
				suspendVal := !sched.Active
				cronJob.Spec.Suspend = &suspendVal
				_, updateErr := cronJobClient.Update(r.Context(), cronJob, metav1.UpdateOptions{})
				if updateErr != nil {
					log.Printf("Error updating CronJob suspend status on cluster: %v", updateErr)
				}
			} else {
				log.Printf("CronJob %s not found in namespace %s: %v", dnsName, sched.Namespace, getErr)
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sched)
}

func (s *Server) handleListAlerts(w http.ResponseWriter, r *http.Request) {
	list, err := s.db.GetAlerts()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to get alerts: %v"}`, err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(list)
}

func (s *Server) handleListPods(w http.ResponseWriter, r *http.Request) {
	clusterID := r.PathValue("id")
	namespace := r.URL.Query().Get("namespace")
	if namespace == "all" {
		namespace = ""
	} else if namespace == "" {
		namespace = "default"
	}

	client, isMock, err := s.getClusterClient(clusterID)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	if isMock {
		mockPods := []map[string]string{
			{"name": "k6-load-test-run-initializer-pq72k", "status": "Completed"},
			{"name": "k6-load-test-run-runner-ab12c", "status": "Running"},
			{"name": "k6-load-test-run-runner-xy89z", "status": "Running"},
			{"name": "k6-test-script-initializer-99fgh", "status": "Completed"},
			{"name": "k6-test-script-runner-zxcv8", "status": "Finished"},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(mockPods)
		return
	}

	podList, err := client.Clientset.CoreV1().Pods(namespace).List(r.Context(), metav1.ListOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to list pods: %v"}`, err), http.StatusInternalServerError)
		return
	}

	var pods []map[string]string
	for _, pod := range podList.Items {
		pods = append(pods, map[string]string{
			"name":   pod.Name,
			"status": string(pod.Status.Phase),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(pods)
}

func (s *Server) handleGetPodLogs(w http.ResponseWriter, r *http.Request) {
	clusterID := r.PathValue("id")
	podName := r.PathValue("pod_name")
	namespace := r.URL.Query().Get("namespace")
	if namespace == "" {
		namespace = "default"
	}

	client, isMock, err := s.getClusterClient(clusterID)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	if isMock {
		w.Header().Set("Content-Type", "text/plain")
		w.Write([]byte("Mock Log Line 1\nMock Log Line 2\nMock Log Line 3\n"))
		return
	}

	tailLines := int64(100)
	podLogOptions := &corev1.PodLogOptions{
		Follow:    r.URL.Query().Get("follow") == "true",
		TailLines: &tailLines,
	}

	req := client.Clientset.CoreV1().Pods(namespace).GetLogs(podName, podLogOptions)
	stream, err := req.Stream(r.Context())
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to stream logs: %v"}`, err), http.StatusInternalServerError)
		return
	}
	defer stream.Close()

	w.Header().Set("Content-Type", "text/plain")
	w.Header().Set("Transfer-Encoding", "chunked")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, `{"error":"streaming not supported"}`, http.StatusInternalServerError)
		return
	}

	buf := make([]byte, 1024)
	for {
		n, err := stream.Read(buf)
		if n > 0 {
			w.Write(buf[:n])
			flusher.Flush()
		}
		if err != nil {
			if err == io.EOF {
				break
			}
			break
		}
	}
}

func (s *Server) handleStreamRunMetrics(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("run_id")
	metric := r.URL.Query().Get("metric")
	if metric == "" {
		metric = "http_req_duration"
	}
	cluster := r.URL.Query().Get("cluster")
	namespace := r.URL.Query().Get("namespace")

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	points, err := s.influxSvc.QueryK6Metrics(r.Context(), runID, metric, "5m", "", "", cluster, namespace)
	if err == nil {
		data, _ := json.Marshal(points)
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
	}

	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			points, err := s.influxSvc.QueryK6Metrics(r.Context(), runID, metric, "10s", "", "", cluster, namespace)
			if err != nil {
				continue
			}
			data, _ := json.Marshal(points)
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}
	}
}



