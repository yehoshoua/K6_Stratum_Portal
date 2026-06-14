package database

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

type DB struct {
	conn *sql.DB
}

type ClusterConfig struct {
	ID                string    `json:"id"`
	Name              string    `json:"name"`
	APIServerURL      string    `json:"api_server_url"`
	AuthType          string    `json:"auth_type"`
	EncryptedData     string    `json:"-"`
	CACertBase64      string    `json:"ca_cert_base64,omitempty"`
	CreatedAt         time.Time `json:"created_at"`
	KubernetesVersion string    `json:"kubernetes_version,omitempty"`
	Region            string    `json:"region,omitempty"`
	Namespaces        string    `json:"namespaces,omitempty"` // Comma-separated list of allowed namespaces
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
	CPULimit      string    `json:"cpu_limit"`
	MemLimit      string    `json:"mem_limit"`
	ScriptContent string    `json:"script_content"`
	CreatedAt     time.Time `json:"created_at"`
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



func InitDB(dbPath string) (*DB, error) {
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create db directory: %w", err)
	}

	conn, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	db := &DB{conn: conn}

	if err := db.createTables(); err != nil {
		conn.Close()
		return nil, err
	}

	return db, nil
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
		created_at DATETIME NOT NULL,
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
		created_at DATETIME NOT NULL
	);`

	templatesTable := `
	CREATE TABLE IF NOT EXISTS k6_templates (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		parallelism INTEGER NOT NULL,
		script_name TEXT NOT NULL,
		script_file TEXT NOT NULL,
		cpu_limit TEXT NOT NULL,
		mem_limit TEXT NOT NULL,
		script_content TEXT NOT NULL,
		created_at DATETIME NOT NULL
	);`

	usersTable := `
	CREATE TABLE IF NOT EXISTS users (
		username TEXT PRIMARY KEY,
		password_hash TEXT NOT NULL,
		salt TEXT NOT NULL,
		role TEXT NOT NULL,
		created_at DATETIME NOT NULL
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

	// Seed default administrator user if users table is empty
	var count int
	if err := db.conn.QueryRow("SELECT COUNT(*) FROM users").Scan(&count); err == nil && count == 0 {
		defaultSalt := "default_admin_salt_12345"
		hasher := sha256.New()
		hasher.Write([]byte("admin" + defaultSalt))
		defaultHash := hex.EncodeToString(hasher.Sum(nil))

		seedQuery := "INSERT INTO users (username, password_hash, salt, role, created_at) VALUES (?, ?, ?, ?, ?)"
		_, seedErr := db.conn.Exec(seedQuery, "admin", defaultHash, defaultSalt, "administrator", time.Now())
		if seedErr != nil {
			return fmt.Errorf("failed to seed default administrator user: %w", seedErr)
		}
	}

	// Migration: Add namespaces column to clusters table if it does not exist
	var hasNamespaces bool
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
	if !hasNamespaces {
		if _, err := db.conn.Exec("ALTER TABLE clusters ADD COLUMN namespaces TEXT;"); err != nil {
			log.Printf("Warning: failed to migrate namespaces column on clusters: %v", err)
		}
	}

	// Migration: Add name, admin_groups, and editor_groups columns to sso_config table if they do not exist
	var hasSsoName, hasAdminGroups, hasEditorGroups bool
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
	query := `
	INSERT OR REPLACE INTO clusters (id, name, api_server_url, auth_type, encrypted_data, ca_cert_base64, created_at, kubernetes_version, region, namespaces)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`

	_, err := db.conn.Exec(query, c.ID, c.Name, c.APIServerURL, c.AuthType, c.EncryptedData, c.CACertBase64, c.CreatedAt, c.KubernetesVersion, c.Region, c.Namespaces)
	return err
}

func (db *DB) GetClusters() ([]*ClusterConfig, error) {
	query := `SELECT id, name, api_server_url, auth_type, encrypted_data, ca_cert_base64, created_at, kubernetes_version, region, namespaces FROM clusters;`
	rows, err := db.conn.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]*ClusterConfig, 0)
	for rows.Next() {
		var c ClusterConfig
		err := rows.Scan(&c.ID, &c.Name, &c.APIServerURL, &c.AuthType, &c.EncryptedData, &c.CACertBase64, &c.CreatedAt, &c.KubernetesVersion, &c.Region, &c.Namespaces)
		if err != nil {
			return nil, err
		}
		list = append(list, &c)
	}
	return list, nil
}

func (db *DB) DeleteCluster(id string) error {
	query := `DELETE FROM clusters WHERE id = ?;`
	_, err := db.conn.Exec(query, id)
	return err
}

func (db *DB) SaveSetting(key, value string) error {
	query := `INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);`
	_, err := db.conn.Exec(query, key, value)
	return err
}

func (db *DB) GetSetting(key string) (string, error) {
	query := `SELECT value FROM settings WHERE key = ?;`
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

func (db *DB) SaveInfluxConfig(c *InfluxConfig) error {
	query := `
	INSERT OR REPLACE INTO influx_configs (id, name, version, url, token, org, bucket, username, password, method, is_active, created_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`
	isActiveVal := 0
	if c.IsActive {
		isActiveVal = 1
	}
	_, err := db.conn.Exec(query, c.ID, c.Name, c.Version, c.URL, c.Token, c.Org, c.Bucket, c.Username, c.Password, c.Method, isActiveVal, c.CreatedAt)
	return err
}

func (db *DB) GetInfluxConfigs() ([]*InfluxConfig, error) {
	query := `SELECT id, name, version, url, token, org, bucket, username, password, method, is_active, created_at FROM influx_configs ORDER BY created_at DESC;`
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
	query := `DELETE FROM influx_configs WHERE id = ?;`
	_, err := db.conn.Exec(query, id)
	return err
}

func (db *DB) SetActiveInfluxConfig(id string) error {
	tx, err := db.conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`UPDATE influx_configs SET is_active = 0;`); err != nil {
		return err
	}

	if _, err := tx.Exec(`UPDATE influx_configs SET is_active = 1 WHERE id = ?;`, id); err != nil {
		return err
	}

	return tx.Commit()
}

func (db *DB) GetActiveInfluxConfig() (*InfluxConfig, error) {
	query := `SELECT id, name, version, url, token, org, bucket, username, password, method, is_active, created_at FROM influx_configs WHERE is_active = 1 LIMIT 1;`
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
	query := `
	INSERT OR REPLACE INTO k6_templates (id, name, parallelism, script_name, script_file, cpu_limit, mem_limit, script_content, created_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`
	_, err := db.conn.Exec(query, t.ID, t.Name, t.Parallelism, t.ScriptName, t.ScriptFile, t.CPULimit, t.MemLimit, t.ScriptContent, t.CreatedAt)
	return err
}

func (db *DB) GetTemplates() ([]*K6Template, error) {
	query := `SELECT id, name, parallelism, script_name, script_file, cpu_limit, mem_limit, script_content, created_at FROM k6_templates ORDER BY created_at DESC;`
	rows, err := db.conn.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]*K6Template, 0)
	for rows.Next() {
		var t K6Template
		err := rows.Scan(&t.ID, &t.Name, &t.Parallelism, &t.ScriptName, &t.ScriptFile, &t.CPULimit, &t.MemLimit, &t.ScriptContent, &t.CreatedAt)
		if err != nil {
			return nil, err
		}
		list = append(list, &t)
	}
	return list, nil
}

func (db *DB) DeleteTemplate(id string) error {
	query := `DELETE FROM k6_templates WHERE id = ?;`
	_, err := db.conn.Exec(query, id)
	return err
}

func (db *DB) SaveUser(u *User) error {
	query := `INSERT OR REPLACE INTO users (username, password_hash, salt, role, created_at) VALUES (?, ?, ?, ?, ?);`
	_, err := db.conn.Exec(query, u.Username, u.PasswordHash, u.Salt, u.Role, u.CreatedAt)
	return err
}

func (db *DB) DeleteUser(username string) error {
	query := `DELETE FROM users WHERE username = ?;`
	_, err := db.conn.Exec(query, username)
	return err
}

func (db *DB) GetUsers() ([]*User, error) {
	query := `SELECT username, password_hash, salt, role, created_at FROM users ORDER BY created_at DESC;`
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
	query := `SELECT username, password_hash, salt, role, created_at FROM users WHERE username = ? LIMIT 1;`
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
	query := `
	INSERT OR REPLACE INTO sso_config (key, enabled, name, issuer_url, client_id, client_secret, redirect_uri, admin_groups, editor_groups)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`
	enabledVal := 0
	if c.Enabled {
		enabledVal = 1
	}
	_, err := db.conn.Exec(query, "main", enabledVal, c.Name, c.IssuerURL, c.ClientID, c.ClientSecret, c.RedirectURI, c.AdminGroups, c.EditorGroups)
	return err
}

func (db *DB) GetSSOConfig() (*SSOConfig, error) {
	query := `SELECT enabled, name, issuer_url, client_id, client_secret, redirect_uri, admin_groups, editor_groups FROM sso_config WHERE key = 'main' LIMIT 1;`
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


