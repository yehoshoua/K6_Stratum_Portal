package database

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "github.com/lib/pq"
	_ "github.com/mattn/go-sqlite3"
)

type DB struct {
	conn   *sql.DB
	driver string
}

type ClusterConfig struct {
	ID                  string    `json:"id"`
	Name                string    `json:"name"`
	APIServerURL        string    `json:"api_server_url"`
	AuthType            string    `json:"auth_type"`
	EncryptedData       string    `json:"-"`
	CACertBase64        string    `json:"ca_cert_base64,omitempty"`
	CreatedAt           time.Time `json:"created_at"`
	KubernetesVersion   string    `json:"kubernetes_version,omitempty"`
	Region              string    `json:"region,omitempty"`
	Namespaces          string    `json:"namespaces,omitempty"`     // Comma-separated list of allowed namespaces
	AWSAccountID        string    `json:"aws_account_id,omitempty"` // AWS Account ID for ECR image resolution
	K6OperatorInstalled bool      `json:"k6_operator_installed"`
}

type InfluxConfig struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Version   string    `json:"version"` // "v1" or "v2"
	URL       string    `json:"url"`
	Token     string    `json:"token,omitempty"`
	Org       string    `json:"org,omitempty"`
	Bucket    string    `json:"bucket"`
	Username  string    `json:"username,omitempty"`
	Password  string    `json:"password,omitempty"`
	Method    string    `json:"method,omitempty"` // "GET" or "POST"
	IsActive  bool      `json:"is_active"`
	CreatedAt time.Time `json:"created_at"`
}

type K6Template struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	Parallelism   int       `json:"parallelism"`
	ScriptName    string    `json:"script_name"`
	ScriptFile    string    `json:"script_file"`
	RunnerImage   string    `json:"runner_image"`
	CPULimit      string    `json:"cpu_limit"`
	MemLimit      string    `json:"mem_limit"`
	ScriptContent string    `json:"script_content"`
	CreatedAt     time.Time `json:"created_at"`
	SLAThresholds string    `json:"sla_thresholds,omitempty"`
}

type TestSchedule struct {
	ID             int       `json:"id"`
	Name           string    `json:"name"`
	ClusterID      string    `json:"cluster_id"`
	Namespace      string    `json:"namespace"`
	TemplateID     string    `json:"template_id"`
	CronExpression string    `json:"cron_expression"`
	Active         bool      `json:"active"`
	CreatedAt      time.Time `json:"created_at"`
}

type TestAlert struct {
	ID        int       `json:"id"`
	TestRunID string    `json:"test_run_id"`
	Metric    string    `json:"metric"`
	Threshold string    `json:"threshold"`
	Value     float64   `json:"value"`
	Timestamp time.Time `json:"timestamp"`
}

type User struct {
	Username     string    `json:"username"`
	PasswordHash string    `json:"-"`
	Salt         string    `json:"-"`
	Role         string    `json:"role"`
	CreatedAt    time.Time `json:"created_at"`
}

type SSOConfig struct {
	Name         string `json:"name"`
	Enabled      bool   `json:"enabled"`
	IssuerURL    string `json:"issuer_url"`
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret,omitempty"`
	RedirectURI  string `json:"redirect_uri"`
	AdminGroups  string `json:"admin_groups"`
	EditorGroups string `json:"editor_groups"`
}

func InitDB(driverName, dsn string) (*DB, error) {
	if driverName == "" {
		driverName = "sqlite3"
	}

	if driverName == "sqlite3" || driverName == "sqlite" {
		driverName = "sqlite3"
		dir := filepath.Dir(dsn)
		if err := os.MkdirAll(dir, 0755); err != nil {
			return nil, fmt.Errorf("failed to create db directory: %w", err)
		}
	}

	conn, err := sql.Open(driverName, dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	db := &DB{conn: conn, driver: driverName}

	if err := db.createTables(); err != nil {
		conn.Close()
		return nil, err
	}

	return db, nil
}

func (db *DB) rebind(query string) string {
	if db.driver != "postgres" {
		return query
	}
	var sb strings.Builder
	paramIndex := 1
	for _, r := range query {
		if r == '?' {
			sb.WriteString(fmt.Sprintf("$%d", paramIndex))
			paramIndex++
		} else {
			sb.WriteRune(r)
		}
	}
	return sb.String()
}

func (db *DB) Close() error {
	return db.conn.Close()
}

func (db *DB) createTables() error {
	clusterTable := `
	CREATE TABLE IF NOT EXISTS clusters (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		api_server_url TEXT NOT NULL,
		auth_type TEXT NOT NULL,
		encrypted_data TEXT,
		ca_cert_base64 TEXT,
		created_at TIMESTAMP NOT NULL,
		kubernetes_version TEXT,
		region TEXT,
		namespaces TEXT
	);`

	settingsTable := `
	CREATE TABLE IF NOT EXISTS settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	);`

	influxTable := `
	CREATE TABLE IF NOT EXISTS influx_configs (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		version TEXT NOT NULL,
		url TEXT NOT NULL,
		token TEXT,
		org TEXT,
		bucket TEXT NOT NULL,
		username TEXT,
		password TEXT,
		method TEXT,
		is_active INTEGER DEFAULT 0,
		created_at TIMESTAMP NOT NULL
	);`

	templatesTable := `
	CREATE TABLE IF NOT EXISTS k6_templates (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		parallelism INTEGER NOT NULL,
		script_name TEXT NOT NULL,
		script_file TEXT NOT NULL,
		runner_image TEXT,
		cpu_limit TEXT NOT NULL,
		mem_limit TEXT NOT NULL,
		script_content TEXT NOT NULL,
		created_at TIMESTAMP NOT NULL,
		sla_thresholds TEXT
	);`

	usersTable := `
	CREATE TABLE IF NOT EXISTS users (
		username TEXT PRIMARY KEY,
		password_hash TEXT NOT NULL,
		salt TEXT NOT NULL,
		role TEXT NOT NULL,
		created_at TIMESTAMP NOT NULL
	);`

	ssoConfigTable := `
	CREATE TABLE IF NOT EXISTS sso_config (
		key TEXT PRIMARY KEY,
		enabled INTEGER DEFAULT 0,
		name TEXT DEFAULT '',
		issuer_url TEXT NOT NULL,
		client_id TEXT NOT NULL,
		client_secret TEXT NOT NULL,
		redirect_uri TEXT NOT NULL,
		admin_groups TEXT DEFAULT '',
		editor_groups TEXT DEFAULT ''
	);`

	apiTokensTable := `
	CREATE TABLE IF NOT EXISTS api_tokens (
		token_hash TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		role TEXT NOT NULL,
		created_at TIMESTAMP NOT NULL,
		expires_at TIMESTAMP
	);`

	if _, err := db.conn.Exec(clusterTable); err != nil {
		return fmt.Errorf("failed to create clusters table: %w", err)
	}

	if _, err := db.conn.Exec(settingsTable); err != nil {
		return fmt.Errorf("failed to create settings table: %w", err)
	}

	if _, err := db.conn.Exec(influxTable); err != nil {
		return fmt.Errorf("failed to create influx_configs table: %w", err)
	}

	if _, err := db.conn.Exec(templatesTable); err != nil {
		return fmt.Errorf("failed to create k6_templates table: %w", err)
	}

	if _, err := db.conn.Exec(usersTable); err != nil {
		return fmt.Errorf("failed to create users table: %w", err)
	}

	if _, err := db.conn.Exec(ssoConfigTable); err != nil {
		return fmt.Errorf("failed to create sso_config table: %w", err)
	}

	if _, err := db.conn.Exec(apiTokensTable); err != nil {
		return fmt.Errorf("failed to create api_tokens table: %w", err)
	}

	var testSchedulesTable string
	var testAlertsTable string
	if db.driver == "postgres" {
		testSchedulesTable = `
		CREATE TABLE IF NOT EXISTS test_schedules (
			id SERIAL PRIMARY KEY,
			name TEXT NOT NULL,
			cluster_id TEXT NOT NULL,
			namespace TEXT NOT NULL,
			template_id TEXT NOT NULL,
			cron_expression TEXT NOT NULL,
			active INTEGER DEFAULT 1,
			created_at TIMESTAMP NOT NULL
		);`
		testAlertsTable = `
		CREATE TABLE IF NOT EXISTS test_alerts (
			id SERIAL PRIMARY KEY,
			test_run_id TEXT NOT NULL,
			metric TEXT NOT NULL,
			threshold TEXT NOT NULL,
			value DOUBLE PRECISION NOT NULL,
			timestamp TIMESTAMP NOT NULL
		);`
	} else {
		testSchedulesTable = `
		CREATE TABLE IF NOT EXISTS test_schedules (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			cluster_id TEXT NOT NULL,
			namespace TEXT NOT NULL,
			template_id TEXT NOT NULL,
			cron_expression TEXT NOT NULL,
			active INTEGER DEFAULT 1,
			created_at TIMESTAMP NOT NULL
		);`
		testAlertsTable = `
		CREATE TABLE IF NOT EXISTS test_alerts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			test_run_id TEXT NOT NULL,
			metric TEXT NOT NULL,
			threshold TEXT NOT NULL,
			value REAL NOT NULL,
			timestamp TIMESTAMP NOT NULL
		);`
	}

	if _, err := db.conn.Exec(testSchedulesTable); err != nil {
		return fmt.Errorf("failed to create test_schedules table: %w", err)
	}
	if _, err := db.conn.Exec(testAlertsTable); err != nil {
		return fmt.Errorf("failed to create test_alerts table: %w", err)
	}

	// Seed default administrator user if users table is empty
	var count int
	countQuery := db.rebind("SELECT COUNT(*) FROM users")
	if err := db.conn.QueryRow(countQuery).Scan(&count); err == nil && count == 0 {
		defaultSalt := "default_admin_salt_12345"
		hasher := sha256.New()
		hasher.Write([]byte("admin" + defaultSalt))
		defaultHash := hex.EncodeToString(hasher.Sum(nil))

		seedQuery := db.rebind("INSERT INTO users (username, password_hash, salt, role, created_at) VALUES (?, ?, ?, ?, ?)")
		_, seedErr := db.conn.Exec(seedQuery, "admin", defaultHash, defaultSalt, "administrator", time.Now())
		if seedErr != nil {
			return fmt.Errorf("failed to seed default administrator user: %w", seedErr)
		}
	}

	// Migration: Add namespaces column to clusters table if it does not exist
	var hasNamespaces bool
	if db.driver == "postgres" {
		query := `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clusters' AND column_name='namespaces');`
		_ = db.conn.QueryRow(query).Scan(&hasNamespaces)
	} else {
		rows, err := db.conn.Query("PRAGMA table_info(clusters);")
		if err == nil {
			for rows.Next() {
				var cid int
				var name, ctype string
				var notnull, pk int
				var dfltVal sql.NullString
				if err := rows.Scan(&cid, &name, &ctype, &notnull, &dfltVal, &pk); err == nil {
					if name == "namespaces" {
						hasNamespaces = true
					}
				}
			}
			rows.Close()
		}
	}
	if !hasNamespaces {
		if _, err := db.conn.Exec("ALTER TABLE clusters ADD COLUMN namespaces TEXT;"); err != nil {
			log.Printf("Warning: failed to migrate namespaces column on clusters: %v", err)
		}
	}

	// Migration: Add aws_account_id column to clusters table if it does not exist
	var hasAWSAccountID bool
	if db.driver == "postgres" {
		_ = db.conn.QueryRow("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clusters' AND column_name='aws_account_id');").Scan(&hasAWSAccountID)
	} else {
		awsRows, err := db.conn.Query("PRAGMA table_info(clusters);")
		if err == nil {
			for awsRows.Next() {
				var cid int
				var name, ctype string
				var notnull, pk int
				var dfltVal sql.NullString
				if err := awsRows.Scan(&cid, &name, &ctype, &notnull, &dfltVal, &pk); err == nil {
					if name == "aws_account_id" {
						hasAWSAccountID = true
					}
				}
			}
			awsRows.Close()
		}
	}
	if !hasAWSAccountID {
		if _, err := db.conn.Exec("ALTER TABLE clusters ADD COLUMN aws_account_id TEXT DEFAULT '';"); err != nil {
			log.Printf("Warning: failed to migrate aws_account_id column on clusters: %v", err)
		}
	}

	db.ensureSlaThresholdsColumn()

	db.ensureRunnerImageColumn()

	// Migration: Add name, admin_groups, and editor_groups columns to sso_config table if they do not exist
	var hasSsoName, hasAdminGroups, hasEditorGroups bool
	if db.driver == "postgres" {
		_ = db.conn.QueryRow("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sso_config' AND column_name='name');").Scan(&hasSsoName)
		_ = db.conn.QueryRow("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sso_config' AND column_name='admin_groups');").Scan(&hasAdminGroups)
		_ = db.conn.QueryRow("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sso_config' AND column_name='editor_groups');").Scan(&hasEditorGroups)
	} else {
		ssoRows, err := db.conn.Query("PRAGMA table_info(sso_config);")
		if err == nil {
			for ssoRows.Next() {
				var cid int
				var name, ctype string
				var notnull, pk int
				var dfltVal sql.NullString
				if err := ssoRows.Scan(&cid, &name, &ctype, &notnull, &dfltVal, &pk); err == nil {
					if name == "name" {
						hasSsoName = true
					}
					if name == "admin_groups" {
						hasAdminGroups = true
					}
					if name == "editor_groups" {
						hasEditorGroups = true
					}
				}
			}
			ssoRows.Close()
		}
	}
	if !hasSsoName {
		if _, err := db.conn.Exec("ALTER TABLE sso_config ADD COLUMN name TEXT DEFAULT '';"); err != nil {
			log.Printf("Warning: failed to migrate name column on sso_config: %v", err)
		}
	}
	if !hasAdminGroups {
		if _, err := db.conn.Exec("ALTER TABLE sso_config ADD COLUMN admin_groups TEXT DEFAULT '';"); err != nil {
			log.Printf("Warning: failed to migrate admin_groups column on sso_config: %v", err)
		}
	}
	if !hasEditorGroups {
		if _, err := db.conn.Exec("ALTER TABLE sso_config ADD COLUMN editor_groups TEXT DEFAULT '';"); err != nil {
			log.Printf("Warning: failed to migrate editor_groups column on sso_config: %v", err)
		}
	}

	return nil
}

func (db *DB) SaveCluster(c *ClusterConfig) error {
	var query string
	if db.driver == "postgres" {
		query = `
		INSERT INTO clusters (id, name, api_server_url, auth_type, encrypted_data, ca_cert_base64, created_at, kubernetes_version, region, namespaces, aws_account_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (id) DO UPDATE SET
			name = EXCLUDED.name,
			api_server_url = EXCLUDED.api_server_url,
			auth_type = EXCLUDED.auth_type,
			encrypted_data = EXCLUDED.encrypted_data,
			ca_cert_base64 = EXCLUDED.ca_cert_base64,
			created_at = EXCLUDED.created_at,
			kubernetes_version = EXCLUDED.kubernetes_version,
			region = EXCLUDED.region,
			namespaces = EXCLUDED.namespaces,
			aws_account_id = EXCLUDED.aws_account_id;`
	} else {
		query = `
		INSERT OR REPLACE INTO clusters (id, name, api_server_url, auth_type, encrypted_data, ca_cert_base64, created_at, kubernetes_version, region, namespaces, aws_account_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`
	}

	_, err := db.conn.Exec(query, c.ID, c.Name, c.APIServerURL, c.AuthType, c.EncryptedData, c.CACertBase64, c.CreatedAt, c.KubernetesVersion, c.Region, c.Namespaces, c.AWSAccountID)
	return err
}

func (db *DB) GetClusters() ([]*ClusterConfig, error) {
	query := db.rebind(`SELECT id, name, api_server_url, auth_type, encrypted_data, ca_cert_base64, created_at, kubernetes_version, region, namespaces, COALESCE(aws_account_id,'') FROM clusters;`)
	rows, err := db.conn.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]*ClusterConfig, 0)
	for rows.Next() {
		var c ClusterConfig
		err := rows.Scan(&c.ID, &c.Name, &c.APIServerURL, &c.AuthType, &c.EncryptedData, &c.CACertBase64, &c.CreatedAt, &c.KubernetesVersion, &c.Region, &c.Namespaces, &c.AWSAccountID)
		if err != nil {
			return nil, err
		}
		list = append(list, &c)
	}
	return list, nil
}

func (db *DB) DeleteCluster(id string) error {
	query := db.rebind(`DELETE FROM clusters WHERE id = ?;`)
	_, err := db.conn.Exec(query, id)
	return err
}

func (db *DB) SaveSetting(key, value string) error {
	var query string
	if db.driver == "postgres" {
		query = `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`
	} else {
		query = `INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);`
	}
	_, err := db.conn.Exec(query, key, value)
	return err
}

func (db *DB) GetSetting(key string) (string, error) {
	query := db.rebind(`SELECT value FROM settings WHERE key = ?;`)
	var value string
	err := db.conn.QueryRow(query, key).Scan(&value)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", nil
		}
		return "", err
	}
	return value, nil
}

func (db *DB) UpsertSetting(key, value string) error {
	var query string
	if db.driver == "postgres" {
		query = `INSERT INTO settings (key, value) VALUES ($1, $2)
			ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`
	} else {
		query = `INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);`
	}
	_, err := db.conn.Exec(query, key, value)
	return err
}

func (db *DB) SaveInfluxConfig(c *InfluxConfig) error {
	var query string
	isActiveVal := 0
	if c.IsActive {
		isActiveVal = 1
	}
	if db.driver == "postgres" {
		query = `
		INSERT INTO influx_configs (id, name, version, url, token, org, bucket, username, password, method, is_active, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		ON CONFLICT (id) DO UPDATE SET
			name = EXCLUDED.name,
			version = EXCLUDED.version,
			url = EXCLUDED.url,
			token = EXCLUDED.token,
			org = EXCLUDED.org,
			bucket = EXCLUDED.bucket,
			username = EXCLUDED.username,
			password = EXCLUDED.password,
			method = EXCLUDED.method,
			is_active = EXCLUDED.is_active,
			created_at = EXCLUDED.created_at;`
	} else {
		query = `
		INSERT OR REPLACE INTO influx_configs (id, name, version, url, token, org, bucket, username, password, method, is_active, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`
	}
	_, err := db.conn.Exec(query, c.ID, c.Name, c.Version, c.URL, c.Token, c.Org, c.Bucket, c.Username, c.Password, c.Method, isActiveVal, c.CreatedAt)
	return err
}

func (db *DB) GetInfluxConfigs() ([]*InfluxConfig, error) {
	query := db.rebind(`SELECT id, name, version, url, token, org, bucket, username, password, method, is_active, created_at FROM influx_configs ORDER BY created_at DESC;`)
	rows, err := db.conn.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]*InfluxConfig, 0)
	for rows.Next() {
		var c InfluxConfig
		var isActiveVal int
		err := rows.Scan(&c.ID, &c.Name, &c.Version, &c.URL, &c.Token, &c.Org, &c.Bucket, &c.Username, &c.Password, &c.Method, &isActiveVal, &c.CreatedAt)
		if err != nil {
			return nil, err
		}
		c.IsActive = isActiveVal == 1
		list = append(list, &c)
	}
	return list, nil
}

func (db *DB) DeleteInfluxConfig(id string) error {
	query := db.rebind(`DELETE FROM influx_configs WHERE id = ?;`)
	_, err := db.conn.Exec(query, id)
	return err
}

func (db *DB) SetActiveInfluxConfig(id string) error {
	tx, err := db.conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(db.rebind(`UPDATE influx_configs SET is_active = 0;`)); err != nil {
		return err
	}

	if _, err := tx.Exec(db.rebind(`UPDATE influx_configs SET is_active = 1 WHERE id = ?;`), id); err != nil {
		return err
	}

	return tx.Commit()
}

func (db *DB) GetActiveInfluxConfig() (*InfluxConfig, error) {
	query := db.rebind(`SELECT id, name, version, url, token, org, bucket, username, password, method, is_active, created_at FROM influx_configs WHERE is_active = 1 LIMIT 1;`)
	var c InfluxConfig
	var isActiveVal int
	err := db.conn.QueryRow(query).Scan(&c.ID, &c.Name, &c.Version, &c.URL, &c.Token, &c.Org, &c.Bucket, &c.Username, &c.Password, &c.Method, &isActiveVal, &c.CreatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	c.IsActive = isActiveVal == 1
	return &c, nil
}

func (db *DB) SaveTemplate(t *K6Template) error {
	var query string
	if db.driver == "postgres" {
		query = `
		INSERT INTO k6_templates (id, name, parallelism, script_name, script_file, runner_image, cpu_limit, mem_limit, script_content, created_at, sla_thresholds)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (id) DO UPDATE SET
			name = EXCLUDED.name,
			parallelism = EXCLUDED.parallelism,
			script_name = EXCLUDED.script_name,
			script_file = EXCLUDED.script_file,
			runner_image = EXCLUDED.runner_image,
			cpu_limit = EXCLUDED.cpu_limit,
			mem_limit = EXCLUDED.mem_limit,
			script_content = EXCLUDED.script_content,
			created_at = EXCLUDED.created_at,
			sla_thresholds = EXCLUDED.sla_thresholds;`
	} else {
		query = `
		INSERT OR REPLACE INTO k6_templates (id, name, parallelism, script_name, script_file, runner_image, cpu_limit, mem_limit, script_content, created_at, sla_thresholds)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`
	}
	_, err := db.conn.Exec(query, t.ID, t.Name, t.Parallelism, t.ScriptName, t.ScriptFile, t.RunnerImage, t.CPULimit, t.MemLimit, t.ScriptContent, t.CreatedAt, t.SLAThresholds)
	if err != nil && (isMissingColumnError(err, "runner_image") || isMissingColumnError(err, "sla_thresholds")) {
		db.ensureRunnerImageColumn()
		db.ensureSlaThresholdsColumn()
		_, err = db.conn.Exec(query, t.ID, t.Name, t.Parallelism, t.ScriptName, t.ScriptFile, t.RunnerImage, t.CPULimit, t.MemLimit, t.ScriptContent, t.CreatedAt, t.SLAThresholds)
	}
	if err == nil {
		return nil
	}

	// Final fallback for legacy schemas without runner_image/sla_thresholds columns.
	if db.driver != "postgres" && (isMissingColumnError(err, "runner_image") || isMissingColumnError(err, "sla_thresholds")) {
		legacyQuery := `
		INSERT OR REPLACE INTO k6_templates (id, name, parallelism, script_name, script_file, cpu_limit, mem_limit, script_content, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`
		_, err = db.conn.Exec(legacyQuery, t.ID, t.Name, t.Parallelism, t.ScriptName, t.ScriptFile, t.CPULimit, t.MemLimit, t.ScriptContent, t.CreatedAt)
	}
	return err
}

func (db *DB) GetTemplates() ([]*K6Template, error) {
	queries := []struct {
		query          string
		hasRunnerImage bool
		hasSla         bool
	}{
		{db.rebind(`SELECT id, name, parallelism, script_name, script_file, runner_image, cpu_limit, mem_limit, script_content, created_at, sla_thresholds FROM k6_templates ORDER BY created_at DESC;`), true, true},
		{db.rebind(`SELECT id, name, parallelism, script_name, script_file, cpu_limit, mem_limit, script_content, created_at, sla_thresholds FROM k6_templates ORDER BY created_at DESC;`), false, true},
		{db.rebind(`SELECT id, name, parallelism, script_name, script_file, runner_image, cpu_limit, mem_limit, script_content, created_at FROM k6_templates ORDER BY created_at DESC;`), true, false},
		{db.rebind(`SELECT id, name, parallelism, script_name, script_file, cpu_limit, mem_limit, script_content, created_at FROM k6_templates ORDER BY created_at DESC;`), false, false},
	}

	var (
		rows           *sql.Rows
		err            error
		hasRunnerImage bool
		hasSla         bool
	)
	for _, candidate := range queries {
		rows, err = db.conn.Query(candidate.query)
		if err != nil && (isMissingColumnError(err, "runner_image") || isMissingColumnError(err, "sla_thresholds")) {
			continue
		}
		if err == nil {
			hasRunnerImage = candidate.hasRunnerImage
			hasSla = candidate.hasSla
		}
		break
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]*K6Template, 0)
	for rows.Next() {
		var t K6Template
		var slaNull sql.NullString
		var runnerNull sql.NullString
		var scanErr error
		switch {
		case hasRunnerImage && hasSla:
			scanErr = rows.Scan(&t.ID, &t.Name, &t.Parallelism, &t.ScriptName, &t.ScriptFile, &runnerNull, &t.CPULimit, &t.MemLimit, &t.ScriptContent, &t.CreatedAt, &slaNull)
		case hasRunnerImage && !hasSla:
			scanErr = rows.Scan(&t.ID, &t.Name, &t.Parallelism, &t.ScriptName, &t.ScriptFile, &runnerNull, &t.CPULimit, &t.MemLimit, &t.ScriptContent, &t.CreatedAt)
		case !hasRunnerImage && hasSla:
			scanErr = rows.Scan(&t.ID, &t.Name, &t.Parallelism, &t.ScriptName, &t.ScriptFile, &t.CPULimit, &t.MemLimit, &t.ScriptContent, &t.CreatedAt, &slaNull)
		default:
			scanErr = rows.Scan(&t.ID, &t.Name, &t.Parallelism, &t.ScriptName, &t.ScriptFile, &t.CPULimit, &t.MemLimit, &t.ScriptContent, &t.CreatedAt)
		}
		if scanErr != nil {
			return nil, scanErr
		}
		if slaNull.Valid {
			t.SLAThresholds = slaNull.String
		}
		if runnerNull.Valid {
			t.RunnerImage = runnerNull.String
		}
		list = append(list, &t)
	}
	return list, nil
}

func (db *DB) GetTemplate(id string) (*K6Template, error) {
	queries := []struct {
		query          string
		hasRunnerImage bool
		hasSla         bool
	}{
		{db.rebind(`SELECT id, name, parallelism, script_name, script_file, runner_image, cpu_limit, mem_limit, script_content, created_at, sla_thresholds FROM k6_templates WHERE id = ? LIMIT 1;`), true, true},
		{db.rebind(`SELECT id, name, parallelism, script_name, script_file, cpu_limit, mem_limit, script_content, created_at, sla_thresholds FROM k6_templates WHERE id = ? LIMIT 1;`), false, true},
		{db.rebind(`SELECT id, name, parallelism, script_name, script_file, runner_image, cpu_limit, mem_limit, script_content, created_at FROM k6_templates WHERE id = ? LIMIT 1;`), true, false},
		{db.rebind(`SELECT id, name, parallelism, script_name, script_file, cpu_limit, mem_limit, script_content, created_at FROM k6_templates WHERE id = ? LIMIT 1;`), false, false},
	}

	var (
		t              K6Template
		slaNull        sql.NullString
		runnerNull     sql.NullString
		err            error
		hasRunnerImage bool
		hasSla         bool
	)
	for _, candidate := range queries {
		switch {
		case candidate.hasRunnerImage && candidate.hasSla:
			err = db.conn.QueryRow(candidate.query, id).Scan(&t.ID, &t.Name, &t.Parallelism, &t.ScriptName, &t.ScriptFile, &runnerNull, &t.CPULimit, &t.MemLimit, &t.ScriptContent, &t.CreatedAt, &slaNull)
		case candidate.hasRunnerImage && !candidate.hasSla:
			err = db.conn.QueryRow(candidate.query, id).Scan(&t.ID, &t.Name, &t.Parallelism, &t.ScriptName, &t.ScriptFile, &runnerNull, &t.CPULimit, &t.MemLimit, &t.ScriptContent, &t.CreatedAt)
		case !candidate.hasRunnerImage && candidate.hasSla:
			err = db.conn.QueryRow(candidate.query, id).Scan(&t.ID, &t.Name, &t.Parallelism, &t.ScriptName, &t.ScriptFile, &t.CPULimit, &t.MemLimit, &t.ScriptContent, &t.CreatedAt, &slaNull)
		default:
			err = db.conn.QueryRow(candidate.query, id).Scan(&t.ID, &t.Name, &t.Parallelism, &t.ScriptName, &t.ScriptFile, &t.CPULimit, &t.MemLimit, &t.ScriptContent, &t.CreatedAt)
		}
		if err != nil && (isMissingColumnError(err, "runner_image") || isMissingColumnError(err, "sla_thresholds")) {
			continue
		}
		if err == nil {
			hasRunnerImage = candidate.hasRunnerImage
			hasSla = candidate.hasSla
		}
		break
	}
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	if slaNull.Valid {
		t.SLAThresholds = slaNull.String
	}
	if runnerNull.Valid {
		t.RunnerImage = runnerNull.String
	}
	if !hasRunnerImage {
		t.RunnerImage = ""
	}
	if !hasSla {
		t.SLAThresholds = ""
	}
	return &t, nil
}

func (db *DB) DeleteTemplate(id string) error {
	query := db.rebind(`DELETE FROM k6_templates WHERE id = ?;`)
	_, err := db.conn.Exec(query, id)
	return err
}

func (db *DB) ensureRunnerImageColumn() {
	if db.driver == "postgres" {
		if _, err := db.conn.Exec("ALTER TABLE k6_templates ADD COLUMN IF NOT EXISTS runner_image TEXT;"); err != nil {
			log.Printf("Warning: failed to migrate runner_image column on k6_templates: %v", err)
		}
		return
	}

	var hasRunnerImage bool
	riRows, err := db.conn.Query("PRAGMA table_info(k6_templates);")
	if err == nil {
		for riRows.Next() {
			var cid int
			var name, ctype string
			var notnull, pk int
			var dfltVal sql.NullString
			if err := riRows.Scan(&cid, &name, &ctype, &notnull, &dfltVal, &pk); err == nil {
				if name == "runner_image" {
					hasRunnerImage = true
				}
			}
		}
		riRows.Close()
	}
	if !hasRunnerImage {
		if _, err := db.conn.Exec("ALTER TABLE k6_templates ADD COLUMN runner_image TEXT;"); err != nil {
			log.Printf("Warning: failed to migrate runner_image column on k6_templates: %v", err)
		}
	}
}

func (db *DB) ensureSlaThresholdsColumn() {
	if db.driver == "postgres" {
		if _, err := db.conn.Exec("ALTER TABLE k6_templates ADD COLUMN IF NOT EXISTS sla_thresholds TEXT;"); err != nil {
			log.Printf("Warning: failed to migrate sla_thresholds column on k6_templates: %v", err)
		}
		return
	}

	var hasSlaThresholds bool
	tRows, err := db.conn.Query("PRAGMA table_info(k6_templates);")
	if err == nil {
		for tRows.Next() {
			var cid int
			var name, ctype string
			var notnull, pk int
			var dfltVal sql.NullString
			if err := tRows.Scan(&cid, &name, &ctype, &notnull, &dfltVal, &pk); err == nil {
				if name == "sla_thresholds" {
					hasSlaThresholds = true
				}
			}
		}
		tRows.Close()
	}
	if !hasSlaThresholds {
		if _, err := db.conn.Exec("ALTER TABLE k6_templates ADD COLUMN sla_thresholds TEXT;"); err != nil {
			log.Printf("Warning: failed to migrate sla_thresholds column on k6_templates: %v", err)
		}
	}
}

func isMissingColumnError(err error, column string) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	col := strings.ToLower(column)
	return (strings.Contains(msg, "no such column") && strings.Contains(msg, col)) ||
		strings.Contains(msg, fmt.Sprintf("column \"%s\" does not exist", col)) ||
		strings.Contains(msg, fmt.Sprintf("has no column named %s", col)) ||
		strings.Contains(msg, fmt.Sprintf("unknown column '%s'", col))
}

func (db *DB) SaveUser(u *User) error {
	var query string
	if db.driver == "postgres" {
		query = `
		INSERT INTO users (username, password_hash, salt, role, created_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (username) DO UPDATE SET
			password_hash = EXCLUDED.password_hash,
			salt = EXCLUDED.salt,
			role = EXCLUDED.role,
			created_at = EXCLUDED.created_at;`
	} else {
		query = `INSERT OR REPLACE INTO users (username, password_hash, salt, role, created_at) VALUES (?, ?, ?, ?, ?);`
	}
	_, err := db.conn.Exec(query, u.Username, u.PasswordHash, u.Salt, u.Role, u.CreatedAt)
	return err
}

func (db *DB) DeleteUser(username string) error {
	query := db.rebind(`DELETE FROM users WHERE username = ?;`)
	_, err := db.conn.Exec(query, username)
	return err
}

func (db *DB) GetUsers() ([]*User, error) {
	query := db.rebind(`SELECT username, password_hash, salt, role, created_at FROM users ORDER BY created_at DESC;`)
	rows, err := db.conn.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]*User, 0)
	for rows.Next() {
		var u User
		err := rows.Scan(&u.Username, &u.PasswordHash, &u.Salt, &u.Role, &u.CreatedAt)
		if err != nil {
			return nil, err
		}
		list = append(list, &u)
	}
	return list, nil
}

func (db *DB) GetUser(username string) (*User, error) {
	query := db.rebind(`SELECT username, password_hash, salt, role, created_at FROM users WHERE username = ? LIMIT 1;`)
	var u User
	err := db.conn.QueryRow(query, username).Scan(&u.Username, &u.PasswordHash, &u.Salt, &u.Role, &u.CreatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &u, nil
}

func (db *DB) SaveSSOConfig(c *SSOConfig) error {
	if c.ClientSecret == "" {
		existing, err := db.GetSSOConfig()
		if err == nil && existing != nil && existing.ClientSecret != "" {
			c.ClientSecret = existing.ClientSecret
		}
	}
	var query string
	enabledVal := 0
	if c.Enabled {
		enabledVal = 1
	}
	if db.driver == "postgres" {
		query = `
		INSERT INTO sso_config (key, enabled, name, issuer_url, client_id, client_secret, redirect_uri, admin_groups, editor_groups)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (key) DO UPDATE SET
			enabled = EXCLUDED.enabled,
			name = EXCLUDED.name,
			issuer_url = EXCLUDED.issuer_url,
			client_id = EXCLUDED.client_id,
			client_secret = EXCLUDED.client_secret,
			redirect_uri = EXCLUDED.redirect_uri,
			admin_groups = EXCLUDED.admin_groups,
			editor_groups = EXCLUDED.editor_groups;`
	} else {
		query = `
		INSERT OR REPLACE INTO sso_config (key, enabled, name, issuer_url, client_id, client_secret, redirect_uri, admin_groups, editor_groups)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`
	}
	_, err := db.conn.Exec(query, "main", enabledVal, c.Name, c.IssuerURL, c.ClientID, c.ClientSecret, c.RedirectURI, c.AdminGroups, c.EditorGroups)
	return err
}

func (db *DB) GetSSOConfig() (*SSOConfig, error) {
	query := db.rebind(`SELECT enabled, name, issuer_url, client_id, client_secret, redirect_uri, admin_groups, editor_groups FROM sso_config WHERE key = 'main' LIMIT 1;`)
	var c SSOConfig
	var enabledVal int
	err := db.conn.QueryRow(query).Scan(&enabledVal, &c.Name, &c.IssuerURL, &c.ClientID, &c.ClientSecret, &c.RedirectURI, &c.AdminGroups, &c.EditorGroups)
	if err != nil {
		if err == sql.ErrNoRows {
			return &SSOConfig{Enabled: false}, nil
		}
		return nil, err
	}
	c.Enabled = enabledVal == 1
	return &c, nil
}

type APIToken struct {
	TokenHash string     `json:"token_hash"`
	Name      string     `json:"name"`
	Role      string     `json:"role"`
	CreatedAt time.Time  `json:"created_at"`
	ExpiresAt *time.Time `json:"expires_at"`
}

func (db *DB) SaveAPIToken(tokenHash string, name string, role string, expiresAt *time.Time) error {
	query := db.rebind(`INSERT INTO api_tokens (token_hash, name, role, created_at, expires_at) VALUES (?, ?, ?, ?, ?);`)
	_, err := db.conn.Exec(query, tokenHash, name, role, time.Now(), expiresAt)
	return err
}

func (db *DB) ListAPITokens() ([]*APIToken, error) {
	query := db.rebind(`SELECT token_hash, name, role, created_at, expires_at FROM api_tokens ORDER BY created_at DESC;`)
	rows, err := db.conn.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tokens []*APIToken
	for rows.Next() {
		var t APIToken
		err := rows.Scan(&t.TokenHash, &t.Name, &t.Role, &t.CreatedAt, &t.ExpiresAt)
		if err != nil {
			return nil, err
		}
		tokens = append(tokens, &t)
	}
	return tokens, nil
}

func (db *DB) DeleteAPIToken(tokenHash string) error {
	query := db.rebind(`DELETE FROM api_tokens WHERE token_hash = ?;`)
	_, err := db.conn.Exec(query, tokenHash)
	return err
}

func (db *DB) GetAPITokenByHash(tokenHash string) (*APIToken, error) {
	query := db.rebind(`SELECT token_hash, name, role, created_at, expires_at FROM api_tokens WHERE token_hash = ? LIMIT 1;`)
	var t APIToken
	err := db.conn.QueryRow(query, tokenHash).Scan(&t.TokenHash, &t.Name, &t.Role, &t.CreatedAt, &t.ExpiresAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &t, nil
}

// --- Test Schedules Helpers ---

func (db *DB) SaveSchedule(s *TestSchedule) error {
	var query string
	if db.driver == "postgres" {
		if s.ID > 0 {
			query = `UPDATE test_schedules SET name=$1, cluster_id=$2, namespace=$3, template_id=$4, cron_expression=$5, active=$6 WHERE id=$7`
			_, err := db.conn.Exec(query, s.Name, s.ClusterID, s.Namespace, s.TemplateID, s.CronExpression, s.Active, s.ID)
			return err
		}
		query = `INSERT INTO test_schedules (name, cluster_id, namespace, template_id, cron_expression, active, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`
		return db.conn.QueryRow(query, s.Name, s.ClusterID, s.Namespace, s.TemplateID, s.CronExpression, s.Active, s.CreatedAt).Scan(&s.ID)
	} else {
		if s.ID > 0 {
			query = `UPDATE test_schedules SET name=?, cluster_id=?, namespace=?, template_id=?, cron_expression=?, active=? WHERE id=?`
			_, err := db.conn.Exec(query, s.Name, s.ClusterID, s.Namespace, s.TemplateID, s.CronExpression, s.Active, s.ID)
			return err
		}
		query = `INSERT INTO test_schedules (name, cluster_id, namespace, template_id, cron_expression, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
		res, err := db.conn.Exec(query, s.Name, s.ClusterID, s.Namespace, s.TemplateID, s.CronExpression, s.Active, s.CreatedAt)
		if err != nil {
			return err
		}
		id, err := res.LastInsertId()
		if err == nil {
			s.ID = int(id)
		}
		return nil
	}
}

func (db *DB) GetSchedule(id int) (*TestSchedule, error) {
	query := db.rebind(`SELECT id, name, cluster_id, namespace, template_id, cron_expression, active, created_at FROM test_schedules WHERE id = ?`)
	row := db.conn.QueryRow(query, id)
	var s TestSchedule
	var activeVal int
	err := row.Scan(&s.ID, &s.Name, &s.ClusterID, &s.Namespace, &s.TemplateID, &s.CronExpression, &activeVal, &s.CreatedAt)
	if err != nil {
		return nil, err
	}
	s.Active = activeVal == 1
	return &s, nil
}

func (db *DB) GetSchedules() ([]*TestSchedule, error) {
	query := db.rebind(`SELECT id, name, cluster_id, namespace, template_id, cron_expression, active, created_at FROM test_schedules ORDER BY created_at DESC`)
	rows, err := db.conn.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]*TestSchedule, 0)
	for rows.Next() {
		var s TestSchedule
		var activeVal int
		err := rows.Scan(&s.ID, &s.Name, &s.ClusterID, &s.Namespace, &s.TemplateID, &s.CronExpression, &activeVal, &s.CreatedAt)
		if err != nil {
			return nil, err
		}
		s.Active = activeVal == 1
		list = append(list, &s)
	}
	return list, nil
}

func (db *DB) DeleteSchedule(id int) error {
	query := db.rebind(`DELETE FROM test_schedules WHERE id = ?`)
	_, err := db.conn.Exec(query, id)
	return err
}

// --- Test Alerts Helpers ---

func (db *DB) SaveAlert(a *TestAlert) error {
	var query string
	if db.driver == "postgres" {
		query = `INSERT INTO test_alerts (test_run_id, metric, threshold, value, timestamp) VALUES ($1, $2, $3, $4, $5) RETURNING id`
		return db.conn.QueryRow(query, a.TestRunID, a.Metric, a.Threshold, a.Value, a.Timestamp).Scan(&a.ID)
	} else {
		query = `INSERT INTO test_alerts (test_run_id, metric, threshold, value, timestamp) VALUES (?, ?, ?, ?, ?)`
		res, err := db.conn.Exec(query, a.TestRunID, a.Metric, a.Threshold, a.Value, a.Timestamp)
		if err != nil {
			return err
		}
		id, err := res.LastInsertId()
		if err == nil {
			a.ID = int(id)
		}
		return nil
	}
}

func (db *DB) GetAlerts() ([]*TestAlert, error) {
	query := db.rebind(`SELECT id, test_run_id, metric, threshold, value, timestamp FROM test_alerts ORDER BY timestamp DESC LIMIT 100`)
	rows, err := db.conn.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]*TestAlert, 0)
	for rows.Next() {
		var a TestAlert
		err := rows.Scan(&a.ID, &a.TestRunID, &a.Metric, &a.Threshold, &a.Value, &a.Timestamp)
		if err != nil {
			return nil, err
		}
		list = append(list, &a)
	}
	return list, nil
}
