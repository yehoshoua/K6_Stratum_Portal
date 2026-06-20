'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { supplementalStrings } from '@/i18n/strings';

export type Language = 'en' | 'fr' | 'he' | 'zh';
export type Theme = 'light' | 'dark' | 'system';
export type ColorPalette = 'default' | 'ocean-blue' | 'gradient-blues' | 'blue-serenity' | 'golden-harvest' | string;

export interface CustomPalette {
  id: string;
  name: string;
  colors: {
    primary: string;
    primaryHover: string;
    primaryLight: string;
    primaryLightest: string;
    primaryDark: string;
    accent: string;
    accentHover: string;
    accentLight: string;
    accentLightest: string;
    accentDark: string;
    backgroundDark: string;
    backgroundLight: string;
  };
}

interface PreferencesContextType {
  lang: Language;
  theme: Theme;
  colorPalette: ColorPalette;
  setLang: (lang: Language) => void;
  setTheme: (theme: Theme) => void;
  setColorPalette: (palette: ColorPalette) => void;
  customPalettes: CustomPalette[];
  addCustomPalette: (palette: CustomPalette) => void;
  deleteCustomPalette: (id: string) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const translations = {
  en: {
    dashboard: "Dashboard",
    reports: "Reports",
    k8sClusters: "K8s Clusters",
    crdControl: "K6s TestRun CRDs",
    influxdb: "InfluxDB Analytics",
    schedules: "CronJob / Job",
    settings: "Settings",
    logout: "Log out",
    connected: "Connected",
    activeAgent: "K8s Agent Active",
    secureSession: "Secured TLS 1.3 Session",
    syncTime: "Last sync",
    addCluster: "Add Cluster",
    welcome: "Welcome to K6 Stratos",
    subWelcome: "Kubernetes & Performance Observability Portal",
    username: "Username",
    password: "Password",
    login: "Log In",
    ssoLogin: "Sign in with SSO",
    localLogin: "Local Login",
    ssoLoginTab: "SSO Authentication",
    defaultAccount: "Default Admin Credentials",
    verifyConn: "Verify Connection",
    status: "Status",
    save: "Save",
    cancel: "Cancel",
    clusterName: "Cluster Name",
    apiServerUrl: "API Server URL",
    authType: "Authentication Type",
    caCert: "CA Certificate (Optional, Base64)",
    crdDetails: "CRD Details",
    specObject: "Kubernetes Spec Object",
    limits: "Resource Limits (Runner)",
    newTest: "New Test",
    runs: "Runs in InfluxDB",
    telemetry: "Telemetry",
    maxVal: "Maximum Value",
    avgVal: "Average Value",
    minVal: "Minimum Value",
    settingsTitle: "Platform Settings",
    settingsSub: "Define Kubernetes clusters and InfluxDB telemetry credentials.",
    influxConfigTitle: "InfluxDB Database Connection",
    influxConfigSub: "Configure parameters used to query performance runs.",
    url: "URL",
    token: "Token",
    org: "Organization",
    bucket: "Bucket",
    accessForbidden: "Access Forbidden",
    adminRequired: "Administrator privileges are required to view this page.",
    theme: "Theme",
    lang: "Language",
    testConn: "Test Connection",
    delete: "Delete",
    runners: "Runners",
    stage: "Stage",
    createdOn: "Created On",
    details: "Details",
    crdList: "k6s.k6.io resources",
    noResources: "No Custom Resource K6 present in this namespace.",
    selectRes: "Select a resource to display its details.",
    instantiateK6: "Instantiate K6 Test",
    launchSpecDesc: "Create a Custom Resource `K6` that deploys the test architecture on the cluster.",
    runName: "Run Name (Resource Name)",
    parallelism: "Parallelism (Runners)",
    scriptConfigMap: "Script ConfigMap",
    jsFile: "JS File",
    cpuLimit: "CPU Limit",
    memLimit: "RAM Limit",
    scheduleTest: "Schedule this test",
    cronExpression: "Cron expression",
    cronExample: "Example: */5 * * * *",
    cronRequired: "Cron expression is required to schedule a test.",
    cronInvalid: "Cron expression must have exactly 5 fields.",
    scheduleRequiresScript: "Select a template or use manual script to schedule.",
    scheduleCreated: "Schedule created successfully!",
    scriptSource: "Script Configuration Method",
    manualScript: "Write script manually",
    existingScript: "Use existing ConfigMap",
    selectConfigMap: "Select Script ConfigMap",
    newConfigMap: "New ConfigMap",
    configMapName: "ConfigMap Name",
    jsFileName: "JS File Name",
    cmContent: "Initial JS Script",
    creatingConfigMap: "Creating...",
    duplicateFrom: "Duplicate from existing (Optional)",
    deploying: "Deploying...",
    deploy: "Deploy",
    clustersK8s: "K8s Clusters",
    inspectClusters: "Inspect K8s API Server connectivity, infrastructure pod health, and secure configurations.",
    k8sVersion: "Kubernetes Version",
    awsRegion: "AWS Region",
    authMech: "Authentication Mechanism",
    registeredOn: "Registered On",
    active: "Active",
    checking: "Checking...",
    fail: "Failed",
    securityCheck: "Security Controls & Status",
    aesActive: "AES-256-GCM encryption active at rest",
    tlsChecked: "Kubernetes CA certificate verified",
    rbacLimit: "RBAC access restricted to test namespace",
    totalClusters: "Total K8s Clusters",
    k6SuccessRate: "K6 Success Rate",
    activeTests: "Active Tests",
    influxTelemetries: "InfluxDB Telemetries",
    recentRuns: "Recent performance runs",
    addClusterDesc: "Register cluster configuration. Sensitive credentials are encrypted via AES-256-GCM.",
    caCertDesc: "CA Certificate (Optional, Base64)",
    secretToken: "Access Token (Bearer)",
    kubeconfigYaml: "Kubeconfig (YAML Content)",
    validating: "Validating...",
    submit: "Submit",
    defaultMockCluster: "Mock Environment",
    registeredK8sClusters: "Your K8s Clusters",
    operatorStatus: "Operator Status",
    recommendations: "Help & Recommendations",
    recDesc: "Use the K6s TestRun CRDs menu to schedule and monitor load runs. Consolidated performance metrics are automatically pushed to InfluxDB and viewable in the InfluxDB Analytics panel.",
    metricsTitle: "InfluxDB Analytics",
    metricsSub: "Visualize historical load runs and track http request rates and user counts.",
    metricRateToggle: "Latency (http_req_duration)",
    metricVUsToggle: "Active Users (vus)",
    metricErrorToggle: "Error Rate (http_req_failed)",
    valMax: "Peak Value",
    valAvg: "Average",
    valMin: "Minimum",
    chartLoading: "Loading telemetry...",
    chartNoData: "No telemetry records found.",
    chartSelectRun: "Select a test run to load performance curves.",
    savedClusters: "Connected Clusters",
    operational: "Operational",
    testRunLabel: "Test Run",
    influxSettingsSuccess: "InfluxDB configuration updated successfully.",
    influxSettingsError: "Failed to update InfluxDB configuration.",
    k8sSettingsError: "Failed to save cluster configuration.",
    k8sLoadError: "Failed to load Kubernetes clusters.",
    deleteClusterTitle: "Delete Kubernetes Cluster",
    deleteClusterConfirmPrefix: "Are you sure you want to delete the K8S Cluster",
    deleteClusterConfirmSuffix: "?",
    deleteClusterWarning: "This action cannot be undone. This will permanently delete the cluster connection and remove it from your dashboard settings.",
    deleteClusterTypePrompt: "Please type the cluster name to confirm:",
    deleteTemplateTitle: "Delete Template",
    deleteTemplateConfirm: "Are you sure you want to delete the template \"{name}\"?",
    deleteUserTitle: "Delete User",
    deleteUserConfirm: "Are you sure you want to delete the user \"{name}\"?",
    cannotDeleteAdmin: "Cannot delete the main admin account.",
    apiTokens: "API Tokens",
    generateToken: "Generate Token",
    tokenName: "Token Name",
    expiry: "Expiration",
    role: "Role",
    create: "Create",
    never: "Never",
    days7: "7 Days",
    days30: "30 Days",
    days90: "90 Days",
    createdAt: "Created At",
    expiresAt: "Expires At",
    tokenCopied: "Token copied to clipboard!",
    copy: "Copy",
    tokenNotice: "Save this token now! It will not be shown again.",
    deleteTokenTitle: "Delete API Token",
    deleteTokenConfirm: "Are you sure you want to delete the API Token \"{name}\"?",
    colorPalette: "Color Palette",
    paletteDefault: "Purple & Pink (Default)",
    paletteOceanBlue: "Ocean Blue Serenity",
    paletteGradientBlues: "Gradient Blues",
    paletteBlueSerenity: "Blue Serenity",
    paletteGoldenHarvest: "Golden Harvest",
    addCustomPalette: "+ Add Custom Palette",
    customPaletteTitle: "Add Custom Palette",
    editCustomPalette: "Edit Custom Palette",
    edit: "Edit",
    paletteName: "Palette Name",
    primaryColor: "Primary Color",
    primaryHover: "Primary Hover",
    primaryLight: "Primary Light",
    primaryLightest: "Primary Lightest",
    primaryDark: "Primary Dark",
    accentColor: "Accent Color",
    accentHover: "Accent Hover",
    accentLight: "Accent Light",
    accentLightest: "Accent Lightest",
    accentDark: "Accent Dark",
    backgroundDark: "Dark Background Color",
    backgroundLight: "Light Background Color",
    createPalette: "Create Palette",
    deletePaletteTitle: "Delete Custom Palette",
    deletePaletteConfirm: "Are you sure you want to delete the custom palette \"{name}\"?",
    ...supplementalStrings.en,
  },
  fr: {
    dashboard: "Tableau de bord",
    reports: "Rapports",
    k8sClusters: "Clusters K8s",
    crdControl: "CRDs K6s TestRun",
    influxdb: "Analyses InfluxDB",
    schedules: "CronJob / Job",
    settings: "Paramètres",
    logout: "Se déconnecter",
    connected: "Connecté",
    activeAgent: "Agent K8s Actif",
    secureSession: "Session TLS 1.3 Sécurisée",
    syncTime: "Dernière synchro",
    addCluster: "Ajouter un Cluster",
    welcome: "Bienvenue sur K6 Stratos",
    subWelcome: "Portail d'Observabilité Kubernetes & Performance",
    username: "Identifiant",
    password: "Mot de passe",
    login: "Se connecter",
    ssoLogin: "Se connecter via le SSO",
    localLogin: "Connexion Locale",
    ssoLoginTab: "Authentification SSO",
    defaultAccount: "Compte par défaut",
    verifyConn: "Tester la connexion",
    status: "Statut",
    save: "Valider",
    cancel: "Annuler",
    clusterName: "Nom du Cluster",
    apiServerUrl: "Adresse de l'API Server (URL)",
    authType: "Type de Connexion",
    caCert: "Certificat CA (Optionnel, Base64)",
    crdDetails: "Détails du CRD",
    specObject: "Objet Spec Kubernetes",
    limits: "Limites de Ressources (Runner)",
    newTest: "Nouveau Test",
    runs: "Runs dans InfluxDB",
    telemetry: "Télémétrie",
    maxVal: "Valeur Maximale",
    avgVal: "Valeur Moyenne",
    minVal: "Valeur Minimale",
    settingsTitle: "Paramètres de la Plateforme",
    settingsSub: "Définissez les clusters Kubernetes et les identifiants de télémétrie InfluxDB.",
    influxConfigTitle: "Connexion Base InfluxDB",
    influxConfigSub: "Configurez les paramètres utilisés pour requêter les runs de performance.",
    url: "URL",
    token: "Token",
    org: "Organisation",
    bucket: "Bucket",
    accessForbidden: "Accès Interdit",
    adminRequired: "Les privilèges d'administrateur sont requis pour accéder à cette page.",
    theme: "Thème",
    lang: "Langue",
    testConn: "Tester la connexion",
    delete: "Supprimer",
    runners: "Exécuteurs",
    stage: "Étape",
    createdOn: "Créé le",
    details: "Détails",
    crdList: "Ressources k6s.k6.io",
    noResources: "Aucune ressource Custom Resource K6 présente dans ce namespace.",
    selectRes: "Sélectionnez une ressource pour afficher ses détails.",
    instantiateK6: "Instancier un Test K6",
    launchSpecDesc: "Créez une ressource Custom Resource `K6` qui déploiera l'architecture de test sur le cluster sélectionné.",
    runName: "Nom du Run (Ressource Name)",
    parallelism: "Parallélisme (Runners)",
    scriptConfigMap: "ConfigMap de Script",
    jsFile: "Fichier JS",
    cpuLimit: "Limites CPU",
    memLimit: "Limites RAM",
    scheduleTest: "Planifier ce test",
    cronExpression: "Expression cron",
    cronExample: "Exemple : */5 * * * *",
    cronRequired: "L'expression cron est requise pour planifier un test.",
    cronInvalid: "L'expression cron doit contenir exactement 5 champs.",
    scheduleRequiresScript: "Sélectionnez un modèle ou utilisez un script manuel pour planifier.",
    scheduleCreated: "Planification créée avec succès !",
    scriptSource: "Méthode de configuration du script",
    manualScript: "Écrire le script manuellement",
    existingScript: "Utiliser une ConfigMap existante",
    selectConfigMap: "Sélectionner la ConfigMap du Script",
    newConfigMap: "Nouvelle ConfigMap",
    configMapName: "Nom de la ConfigMap",
    jsFileName: "Nom du fichier JS",
    cmContent: "Script JS Initial",
    creatingConfigMap: "Création...",
    duplicateFrom: "Dupliquer depuis l'existant (Optionnel)",
    deploying: "Déploiement...",
    deploy: "Déployer",
    clustersK8s: "Clusters K8s",
    inspectClusters: "Inspectez la connectivité de l'API Server, les états des pods d'infrastructure et les configurations sécurisées.",
    k8sVersion: "Version Kubernetes",
    awsRegion: "Région AWS",
    authMech: "Mécanisme d'Authentification",
    registeredOn: "Enregistré le",
    active: "Actif",
    checking: "Vérification...",
    fail: "Échec",
    securityCheck: "Contrôles de Sécurité & Statut",
    aesActive: "Chiffrement AES-256-GCM actif en base de données",
    tlsChecked: "Certificat CA Kubernetes vérifié",
    rbacLimit: "Accès RBAC limité au namespace de test",
    totalClusters: "Clusters K8s Connectés",
    k6SuccessRate: "Taux de Succès K6",
    activeTests: "Tests Actifs",
    influxTelemetries: "Télémétries InfluxDB",
    recentRuns: "Runs récents de performance",
    addClusterDesc: "Enregistrez vos configurations de cluster. Les credentials sensibles sont chiffrés à l'aide d'une clé AES-256-GCM.",
    caCertDesc: "Certificat CA (Optionnel, Base64)",
    secretToken: "Token d'accès (Bearer)",
    kubeconfigYaml: "Kubeconfig (Contenu YAML)",
    validating: "Validation...",
    submit: "Valider",
    defaultMockCluster: "Environnement Mocké",
    registeredK8sClusters: "Vos Clusters Kubernetes",
    operatorStatus: "Statut des Opérateurs",
    recommendations: "Aide & Recommandations",
    recDesc: "Utilisez les menus CRDs K6 Operator pour planifier et suivre vos exécutions de tests de charge. Les résultats de performance consolidés seront automatiquement agrégés dans InfluxDB et consultables via le panneau Analyses InfluxDB.",
    metricsTitle: "Analyses InfluxDB",
    metricsSub: "Visualisez les performances historiques et suivez l'évolution des requêtes HTTP et de la charge utilisateurs.",
    metricRateToggle: "Latence (http_req_duration)",
    metricVUsToggle: "Utilisateurs (vus)",
    metricErrorToggle: "Taux d'erreur (http_req_failed)",
    valMax: "Valeur Maximale",
    valAvg: "Moyenne",
    valMin: "Valeur Minimale",
    chartLoading: "Chargement du graphique...",
    chartNoData: "Pas de données graphiques.",
    chartSelectRun: "Sélectionnez un test run pour charger les graphes de télémétrie.",
    savedClusters: "Clusters Connectés",
    operational: "Opérationnels",
    testRunLabel: "Test Run",
    influxSettingsSuccess: "Configuration InfluxDB mise à jour avec succès.",
    influxSettingsError: "Échec de la mise à jour de la configuration InfluxDB.",
    k8sSettingsError: "Échec de la configuration du cluster.",
    k8sLoadError: "Échec du chargement des clusters Kubernetes.",
    deleteClusterTitle: "Supprimer le Cluster Kubernetes",
    deleteClusterConfirmPrefix: "Êtes-vous sûr de vouloir supprimer le cluster K8S",
    deleteClusterConfirmSuffix: " ?",
    deleteClusterWarning: "Cette action est irréversible. Cela supprimera définitivement la connexion au cluster et la retirera des paramètres de votre tableau de bord.",
    deleteClusterTypePrompt: "Veuillez saisir le nom du cluster pour confirmer :",
    deleteTemplateTitle: "Supprimer le modèle",
    deleteTemplateConfirm: "Êtes-vous sûr de vouloir supprimer le modèle \"{name}\" ?",
    deleteUserTitle: "Supprimer l'utilisateur",
    deleteUserConfirm: "Êtes-vous sûr de vouloir supprimer l'utilisateur \"{name}\" ?",
    cannotDeleteAdmin: "Impossible de supprimer le compte administrateur principal.",
    apiTokens: "Tokens API",
    generateToken: "Générer un token",
    tokenName: "Nom du token",
    expiry: "Expiration",
    role: "Rôle",
    create: "Créer",
    never: "Jamais",
    days7: "7 Jours",
    days30: "30 Jours",
    days90: "90 Jours",
    createdAt: "Créé le",
    expiresAt: "Expire le",
    tokenCopied: "Token copié dans le presse-papiers !",
    copy: "Copier",
    tokenNotice: "Enregistrez ce token maintenant ! Il ne sera plus affiché.",
    deleteTokenTitle: "Supprimer le token API",
    deleteTokenConfirm: "Êtes-vous sûr de vouloir supprimer le token API \"{name}\" ?",
    colorPalette: "Palette de Couleurs",
    paletteDefault: "Violet & Rose (Défaut)",
    paletteOceanBlue: "Bleu Océan Sérénité",
    paletteGradientBlues: "Dégradés de Bleu",
    paletteBlueSerenity: "Bleu Sérénité",
    paletteGoldenHarvest: "Moisson Dorée",
    addCustomPalette: "+ Palette personnalisée",
    customPaletteTitle: "Ajouter une palette personnalisée",
    editCustomPalette: "Modifier la palette personnalisée",
    edit: "Modifier",
    paletteName: "Nom de la palette",
    primaryColor: "Couleur principale",
    primaryHover: "Survol principal",
    primaryLight: "Clair principal",
    primaryLightest: "Très clair principal",
    primaryDark: "Sombre principal",
    accentColor: "Couleur d'accent",
    accentHover: "Survol d'accent",
    accentLight: "Clair d'accent",
    accentLightest: "Très clair d'accent",
    accentDark: "Sombre d'accent",
    backgroundDark: "Couleur de fond sombre",
    backgroundLight: "Couleur de fond claire",
    createPalette: "Créer la palette",
    deletePaletteTitle: "Supprimer la palette personnalisée",
    deletePaletteConfirm: "Êtes-vous sûr de vouloir supprimer la palette personnalisée \"{name}\" ?",
    ...supplementalStrings.fr,
  },
  he: {
    dashboard: "לוח בקרה",
    reports: "דוחות",
    k8sClusters: "K8s Clusters",
    crdControl: "K6s TestRun CRDs",
    influxdb: "אנליטיקת InfluxDB",
    schedules: "CronJob / Job",
    settings: "הגדרות",
    logout: "התנתק",
    connected: "מחובר",
    activeAgent: "סוכן K8s פעיל",
    secureSession: "סשן TLS 1.3 מאובטח",
    syncTime: "סנכרון אחרון",
    addCluster: "הוסף אשכול",
    welcome: "ברוכים הבאים ל-K6 Stratos",
    subWelcome: "פורטל ניטור ביצועים וקיברנטיס",
    username: "שם משתמש",
    password: "סיסמה",
    login: "התחבר",
    ssoLogin: "התחברות באמצעות SSO",
    localLogin: "התחברות מקומית",
    ssoLoginTab: "אימות SSO",
    defaultAccount: "חשבון מנהל ברירת מחדל",
    verifyConn: "בדוק חיבור",
    status: "סטטוס",
    save: "שמור",
    cancel: "ביטול",
    clusterName: "שם האשכול",
    apiServerUrl: "כתובת שרת ה-API",
    authType: "סוג אימות",
    caCert: "אישור CA (אופציונלי, Base64)",
    crdDetails: "פרטי CRD",
    specObject: "אובייקט Spec של קיברנטיס",
    limits: "מגבלות משאבים (Runner)",
    newTest: "בדיקה חדשה",
    runs: "הרצות ב-InfluxDB",
    telemetry: "טלמטריה",
    maxVal: "ערך מקסימלי",
    avgVal: "ערך ממוצע",
    minVal: "ערך מינימלי",
    settingsTitle: "הגדרות פלטפורמה",
    settingsSub: "הגדר אשכולות קיברנטיס ופרטי גישה ל-InfluxDB.",
    influxConfigTitle: "חיבור למסד נתונים InfluxDB",
    influxConfigSub: "הגדר פרמטרים לשאילתות הרצת ביצועים.",
    url: "כתובת URL",
    token: "אסימון (Token)",
    org: "ארגון (Org)",
    bucket: "באקט (Bucket)",
    accessForbidden: "הגישה נחסמה",
    adminRequired: "נדרשות הרשאות מנהל כדי לצפות בדף זה.",
    theme: "ערכת נושא",
    lang: "שפה",
    testConn: "בדוק חיבור",
    delete: "מחק",
    runners: "רצים",
    stage: "שלב",
    createdOn: "נוצר ב",
    details: "פרטים",
    crdList: "משאבי k6s.k6.io",
    noResources: "אין משאבי K6 בNamespace זה.",
    selectRes: "בחר משאב להצגת פרטים.",
    instantiateK6: "צור בדיקת K6 חדשה",
    launchSpecDesc: "צור משאב K6 חדש לפריסת בדיקת העומס באשכול.",
    runName: "שם הבדיקה",
    parallelism: "מקביליות (Runners)",
    scriptConfigMap: "Script ConfigMap",
    jsFile: "קובץ JS",
    cpuLimit: "מגבלת CPU",
    memLimit: "מגבלת RAM",
    scheduleTest: "תזמן את הבדיקה",
    cronExpression: "ביטוי Cron",
    cronExample: "דוגמה: */5 * * * *",
    cronRequired: "נדרש ביטוי Cron כדי לתזמן בדיקה.",
    cronInvalid: "ביטוי Cron חייב להכיל בדיוק 5 שדות.",
    scheduleRequiresScript: "יש לבחור תבנית או להשתמש בסקריפט ידני כדי לתזמן.",
    scheduleCreated: "התזמון נוצר בהצלחה!",
    scriptSource: "שיטת הגדרת הסקריפט",
    manualScript: "כתיבת סקריפט ידנית",
    existingScript: "שימוש ב-ConfigMap קיים",
    selectConfigMap: "בחר ConfigMap של סקריפט",
    newConfigMap: "ConfigMap חדש",
    configMapName: "שם ה-ConfigMap",
    jsFileName: "שם קובץ JS",
    cmContent: "סקריפט JS ראשוני",
    creatingConfigMap: "יוצר...",
    duplicateFrom: "שכפול מתוך קיים (אופציונלי)",
    deploying: "פורס...",
    deploy: "פרוס בדיקה",
    clustersK8s: "K8s Clusters",
    inspectClusters: "בדוק חיבור לשרת ה-API של K8s, בריאות הפודים והגדרות אבטחה.",
    k8sVersion: "גרסת קיברנטיס",
    awsRegion: "אזור AWS",
    authMech: "מנגנון אימות",
    registeredOn: "נרשם ב",
    active: "פעיל",
    checking: "בודק...",
    fail: "נכשל",
    securityCheck: "בקרות אבטחה וסטטוס",
    aesActive: "הצפנת AES-256-GCM פעילה",
    tlsChecked: "אישור CA של קיברנטיס מאומת",
    rbacLimit: "גישת RBAC מוגבלת לNamespace של הבדיקה",
    totalClusters: "סך הכל K8s Clusters",
    k6SuccessRate: "שיעור הצלחה K6",
    activeTests: "בדיקות פעילות",
    influxTelemetries: "חיבורי InfluxDB",
    recentRuns: "הרצות ביצועים אחרונות",
    addClusterDesc: "רשום הגדרות אשכול. פרטי גישה רגישים מוצפנים ב-AES-256-GCM.",
    caCertDesc: "אישור CA (אופציונלי, Base64)",
    secretToken: "אסימון גישה (Bearer)",
    kubeconfigYaml: "קובץ Kubeconfig (תוכן YAML)",
    validating: "מאמת...",
    submit: "שלח",
    defaultMockCluster: "סביבה מדומה",
    registeredK8sClusters: "אשכולות הקיברנטיס שלך",
    operatorStatus: "סטטוס מפעילים (Operators)",
    recommendations: "עזרה והמלצות",
    recDesc: "השתמש בתפריט CRDs של K6 Operator כדי לתזמן ולעקוב אחר בדיקות עומס. מדדי ביצועים נשמרים ב-InfluxDB וזמינים בדף אנליטיקת InfluxDB.",
    metricsTitle: "אנליטיקת InfluxDB",
    metricsSub: "צפה בהרצות ביצועים היסטוריות ועקוב אחר קצב בקשות HTTP וכמות משתמשים.",
    metricRateToggle: "זמן תגובה (http_req_duration)",
    metricVUsToggle: "משתמשים פעילים (vus)",
    metricErrorToggle: "שיעור שגיאות (http_req_failed)",
    valMax: "ערך שיא",
    valAvg: "ממוצע",
    valMin: "מינימום",
    chartLoading: "טוען נתונים...",
    chartNoData: "לא נמצאו נתוני טלמטריה.",
    chartSelectRun: "בחר הרצה לטעינת גרף ביצועים.",
    savedClusters: "אשכולות מחוברים",
    operational: "פעיל ומבצעי",
    testRunLabel: "הרצת בדיקה",
    influxSettingsSuccess: "הגדרות InfluxDB עודכנו בהצלחה.",
    influxSettingsError: "עדכון הגדרות InfluxDB נכשל.",
    k8sSettingsError: "שמירת הגדרות האשכול נכשלה.",
    k8sLoadError: "טעינת אשכולות קיברנטיס נכשלה.",
    deleteClusterTitle: "מחיקת אשכול קיברנטיס",
    deleteClusterConfirmPrefix: "האם אתה בטוח שברצונך למחוק את אשכול ה-K8S",
    deleteClusterConfirmSuffix: "?",
    deleteClusterWarning: "פעולה זו אינה הפיכה. היא תמחק לצמיתות את החיבור לאשכול ותסיר אותו מהגדרות לוח הבקרה.",
    deleteClusterTypePrompt: "אנא הקלד את שם האשכול כדי לאשר:",
    deleteTemplateTitle: "מחיקת תבנית",
    deleteTemplateConfirm: "האם אתה בטוח שברצונך למחוק את התבנית \"{name}\"?",
    deleteUserTitle: "מחיקת משתמש",
    deleteUserConfirm: "האם אתה בטוח שברצונך למחוק את המשתמש \"{name}\"?",
    cannotDeleteAdmin: "לא ניתן למחוק את חשבון המנהל הראשי.",
    apiTokens: "אסימוני API",
    generateToken: "צור אסימון",
    tokenName: "שם האסימון",
    expiry: "תפוגה",
    role: "תפקיד",
    create: "צור",
    never: "אף פעם",
    days7: "7 ימים",
    days30: "30 ימים",
    days90: "90 ימים",
    createdAt: "נוצר ב-",
    expiresAt: "פג ב-",
    tokenCopied: "האסימון הועתק ללוח!",
    copy: "העתק",
    tokenNotice: "שמור אסימון זה כעת! הוא לא יוצג שוב.",
    deleteTokenTitle: "מחק אסימון API",
    deleteTokenConfirm: "האם אתה בטוח שברצונך למחוק את אסימון ה-API \"{name}\"?",
    colorPalette: "פלטת צבעים",
    paletteDefault: "סגול וורוד (ברירת מחדל)",
    paletteOceanBlue: "שלוות כחול אוקיינוס",
    paletteGradientBlues: "כחולים מדורגים",
    paletteBlueSerenity: "שלווה כחולה",
    paletteGoldenHarvest: "קציר הזהב",
    addCustomPalette: "+ הוסף פלטה מותאמת אישית",
    customPaletteTitle: "הוסף פלטה מותאמת אישית",
    editCustomPalette: "ערוך פלטה מותאמת אישית",
    edit: "ערוך",
    paletteName: "שם הפלטה",
    primaryColor: "צבע ראשי",
    primaryHover: "צבע מעבר ראשי",
    primaryLight: "צבע בהיר ראשי",
    primaryLightest: "צבע בהיר ביותר ראשי",
    primaryDark: "צבע כהה ראשי",
    accentColor: "צבע הדגשה",
    accentHover: "צבע מעבר הדגשה",
    accentLight: "צבע בהיר הדגשה",
    accentLightest: "צבע בהיר ביותר הדגשה",
    accentDark: "צבע כהה הדגשה",
    backgroundDark: "צבע רקע כהה",
    backgroundLight: "צבע רקע בהיר",
    createPalette: "צור פלטה",
    deletePaletteTitle: "מחק פלטה מותאמת אישית",
    deletePaletteConfirm: "האם אתה בטוח שברצונך למחוק את הפלטה המותאמת אישית \"{name}\"?",
    ...supplementalStrings.he,
  },
  zh: {
    dashboard: "仪表板",
    reports: "报告",
    k8sClusters: "K8s 集群",
    crdControl: "K6s TestRun CRDs",
    influxdb: "InfluxDB 分析",
    schedules: "CronJob / Job",
    settings: "设置",
    logout: "登出",
    connected: "已连接",
    activeAgent: "K8s 代理已激活",
    secureSession: "安全 TLS 1.3 会话",
    syncTime: "上次同步",
    addCluster: "添加集群",
    welcome: "欢迎使用 K6 Stratos",
    subWelcome: "Kubernetes 与性能观测门户",
    username: "用户名",
    password: "密码",
    login: "登录",
    ssoLogin: "通过 SSO 登录",
    localLogin: "本地登录",
    ssoLoginTab: "SSO 身份验证",
    defaultAccount: "默认管理员账户",
    verifyConn: "测试连接",
    status: "状态",
    save: "保存",
    cancel: "取消",
    clusterName: "集群名称",
    apiServerUrl: "API 服务器 URL",
    authType: "认证类型",
    caCert: "CA 证书（可选，Base64）",
    crdDetails: "CRD 详情",
    specObject: "Kubernetes Spec 对象",
    limits: "资源限制 (Runner)",
    newTest: "新建测试",
    runs: "InfluxDB 运行记录",
    telemetry: "遥测",
    maxVal: "最大值",
    avgVal: "平均值",
    minVal: "最小值",
    settingsTitle: "平台设置",
    settingsSub: "定义 Kubernetes 集群与 InfluxDB 遥测凭据。",
    influxConfigTitle: "InfluxDB 数据库连接",
    influxConfigSub: "配置用于查询性能运行记录的参数。",
    url: "URL地址",
    token: "访问令牌 (Token)",
    org: "组织 (Org)",
    bucket: "存储桶 (Bucket)",
    accessForbidden: "拒绝访问",
    adminRequired: "查看此页面需要管理员权限。",
    theme: "主题",
    lang: "语言",
    testConn: "测试连接",
    delete: "删除",
    runners: "执行器 (Runners)",
    stage: "阶段",
    createdOn: "创建时间",
    details: "详情",
    crdList: "k6s.k6.io 资源列表",
    noResources: "在此命名空间中未找到 K6 自定义资源。",
    selectRes: "选择一个资源以显示其详细信息。",
    instantiateK6: "实例化 K6 测试",
    launchSpecDesc: "创建一个自定义资源 `K6`，在集群上部署负载测试架构。",
    runName: "测试运行名称",
    parallelism: "并发数 (Runners)",
    scriptConfigMap: "脚本 ConfigMap",
    jsFile: "JS 脚本文件",
    cpuLimit: "CPU 限制",
    memLimit: "内存限制",
    scheduleTest: "计划此测试",
    cronExpression: "Cron 表达式",
    cronExample: "示例：*/5 * * * *",
    cronRequired: "计划测试需要填写 Cron 表达式。",
    cronInvalid: "Cron 表达式必须正好包含 5 个字段。",
    scheduleRequiresScript: "请先选择模板或使用手动脚本以便计划运行。",
    scheduleCreated: "计划创建成功！",
    scriptSource: "脚本配置方式",
    manualScript: "手动编写脚本",
    existingScript: "使用现有 ConfigMap",
    selectConfigMap: "选择脚本 ConfigMap",
    newConfigMap: "新建 ConfigMap",
    configMapName: "ConfigMap 名称",
    jsFileName: "JS 文件名称",
    cmContent: "初始 JS 脚本",
    creatingConfigMap: "创建中...",
    duplicateFrom: "从现有复制 (可选)",
    deploying: "部署中...",
    deploy: "部署测试",
    clustersK8s: "K8s 集群",
    inspectClusters: "检查 K8s API 服务器连接性、基础设施 Pod 健康状况和安全配置。",
    k8sVersion: "Kubernetes 版本",
    awsRegion: "AWS 区域",
    authMech: "认证机制",
    registeredOn: "注册时间",
    active: "正常运行",
    checking: "检查中...",
    fail: "失败",
    securityCheck: "安全控制与状态",
    aesActive: "AES-256-GCM 静态加密已启用",
    tlsChecked: "Kubernetes CA 证书已验证",
    rbacLimit: "RBAC 权限仅限于测试命名空间",
    totalClusters: "K8s 集群总数",
    k6SuccessRate: "K6 测试成功率",
    activeTests: "活动测试数",
    influxTelemetries: "InfluxDB 连接数",
    recentRuns: "最近的性能测试",
    addClusterDesc: "注册集群配置。敏感凭据已通过 AES-256-GCM 加密。",
    caCertDesc: "CA 证书 (Base64)",
    secretToken: "访问令牌 (Bearer)",
    kubeconfigYaml: "Kubeconfig (YAML 格式)",
    validating: "验证中...",
    submit: "提交",
    defaultMockCluster: "模拟环境",
    registeredK8sClusters: "您的 Kubernetes 集群",
    operatorStatus: "算子组件状态",
    recommendations: "使用帮助与建议",
    recDesc: "使用 K6s TestRun CRDs 菜单调度和监视负载测试。汇总的性能指标会自动写入 InfluxDB，并可在 InfluxDB 分析面板中查看。",
    metricsTitle: "InfluxDB 数据分析",
    metricsSub: "可视化历史测试运行，跟踪 HTTP 请求速率和活跃用户数。",
    metricRateToggle: "请求延迟 (http_req_duration)",
    metricVUsToggle: "活跃用户数 (vus)",
    metricErrorToggle: "错误率 (http_req_failed)",
    valMax: "峰值",
    valAvg: "平均值",
    valMin: "最小值",
    chartLoading: "加载遥测数据中...",
    chartNoData: "未找到遥测记录。",
    chartSelectRun: "选择一个测试运行记录以加载性能曲线图。",
    savedClusters: "已连接的集群",
    operational: "正常就绪",
    testRunLabel: "测试运行",
    influxSettingsSuccess: "InfluxDB 配置更新成功。",
    influxSettingsError: "更新 InfluxDB 配置失败。",
    k8sSettingsError: "保存集群配置失败。",
    k8sLoadError: "加载 Kubernetes 集群失败。",
    deleteClusterTitle: "删除 Kubernetes 集群",
    deleteClusterConfirmPrefix: "您确定要删除 K8S 集群",
    deleteClusterConfirmSuffix: "吗？",
    deleteClusterWarning: "此操作无法撤销。这将永久删除集群连接并从您的仪表板设置中移除。",
    deleteClusterTypePrompt: "请输入集群名称以进行确认：",
    deleteTemplateTitle: "删除模板",
    deleteTemplateConfirm: "您确定要删除模板 \"{name}\" 吗？",
    deleteUserTitle: "删除用户",
    deleteUserConfirm: "您确定要删除用户 \"{name}\" 吗？",
    cannotDeleteAdmin: "无法删除主管理员账户。",
    apiTokens: "API 令牌",
    generateToken: "生成令牌",
    tokenName: "令牌名称",
    expiry: "有效期",
    role: "角色",
    create: "生成",
    never: "永不过期",
    days7: "7 天",
    days30: "30 天",
    days90: "90 天",
    createdAt: "创建于",
    expiresAt: "过期时间",
    tokenCopied: "令牌已复制到剪贴板！",
    copy: "复制",
    tokenNotice: "请立即保存此令牌！它将不再显示。",
    deleteTokenTitle: "删除 API 令牌",
    deleteTokenConfirm: "确定要删除 API 令牌 \"{name}\" 吗？",
    colorPalette: "色彩调色板",
    paletteDefault: "紫与粉 (默认)",
    paletteOceanBlue: "海洋之蓝 (Ocean Blue Serenity)",
    paletteGradientBlues: "渐变之蓝 (Gradient Blues)",
    paletteBlueSerenity: "宁静之蓝 (Blue Serenity)",
    paletteGoldenHarvest: "金色麦浪 (Golden Harvest)",
    addCustomPalette: "+ 添加自定义调色板",
    customPaletteTitle: "添加自定义调色板",
    editCustomPalette: "编辑自定义调色板",
    edit: "编辑",
    paletteName: "调色板名称",
    primaryColor: "主色",
    primaryHover: "主色悬停",
    primaryLight: "主色浅色",
    primaryLightest: "主色最浅色",
    primaryDark: "主色深色",
    accentColor: "强调色",
    accentHover: "强调色悬停",
    accentLight: "强调色浅色",
    accentLightest: "强调色最浅色",
    accentDark: "强调色深色",
    backgroundDark: "深色背景颜色",
    backgroundLight: "浅色背景颜色",
    createPalette: "创建调色板",
    deletePaletteTitle: "删除自定义调色板",
    deletePaletteConfirm: "确定要删除自定义调色板 \"{name}\" 吗？",
    ...supplementalStrings.zh,
  }
};
export const defaultPalettes: CustomPalette[] = [
  {
    id: 'default',
    name: 'paletteDefault',
    colors: {
      primary: '#a855f7',
      primaryHover: '#9333ea',
      primaryLight: '#c084fc',
      primaryLightest: '#e9d5ff',
      primaryDark: '#581c87',
      accent: '#ec4899',
      accentHover: '#db2777',
      accentLight: '#f472b6',
      accentLightest: '#fbcfe8',
      accentDark: '#831843',
      backgroundDark: '#090d16',
      backgroundLight: '#f1f5f9'
    }
  },
  {
    id: 'ocean-blue',
    name: 'paletteOceanBlue',
    colors: {
      primary: '#0077b6',
      primaryHover: '#023e8a',
      primaryLight: '#00b4d8',
      primaryLightest: '#90e0ef',
      primaryDark: '#03045e',
      accent: '#00b4d8',
      accentHover: '#0077b6',
      accentLight: '#90e0ef',
      accentLightest: '#caf0f8',
      accentDark: '#023e8a',
      backgroundDark: '#090d16',
      backgroundLight: '#f1f5f9'
    }
  },
  {
    id: 'gradient-blues',
    name: 'paletteGradientBlues',
    colors: {
      primary: '#0a9396',
      primaryHover: '#005f73',
      primaryLight: '#94d2bd',
      primaryLightest: '#cae9e0',
      primaryDark: '#003d4c',
      accent: '#94d2bd',
      accentHover: '#0a9396',
      accentLight: '#cae9e0',
      accentLightest: '#e9d8a6',
      accentDark: '#005f73',
      backgroundDark: '#090d16',
      backgroundLight: '#f1f5f9'
    }
  },
  {
    id: 'blue-serenity',
    name: 'paletteBlueSerenity',
    colors: {
      primary: '#3a76b0',
      primaryHover: '#1e4f8c',
      primaryLight: '#a7c6ed',
      primaryLightest: '#d7e3fc',
      primaryDark: '#112244',
      accent: '#a7c6ed',
      accentHover: '#3a76b0',
      accentLight: '#d7e3fc',
      accentLightest: '#edf2fb',
      accentDark: '#1a365d',
      backgroundDark: '#090d16',
      backgroundLight: '#f1f5f9'
    }
  },
  {
    id: 'golden-harvest',
    name: 'paletteGoldenHarvest',
    colors: {
      primary: '#edc531',
      primaryHover: '#a47e1b',
      primaryLight: '#ffe169',
      primaryLightest: '#fbf6cf',
      primaryDark: '#5d4508',
      accent: '#ffe169',
      accentHover: '#edc531',
      accentLight: '#fbf6cf',
      accentLightest: '#fffae0',
      accentDark: '#7a5a0c',
      backgroundDark: '#090d16',
      backgroundLight: '#f1f5f9'
    }
  }
];

const PreferencesContext = createContext<PreferencesContextType | undefined>(undefined);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Language>('en');
  const [theme, setThemeState] = useState<Theme>('system');
  const [colorPalette, setColorPaletteState] = useState<ColorPalette>('default');
  const [customPalettes, setCustomPalettes] = useState<CustomPalette[]>([]);

  // Load from local storage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedLang = localStorage.getItem('pref-lang') as Language;
      const savedTheme = localStorage.getItem('pref-theme') as Theme;
      const savedPalette = localStorage.getItem('pref-palette') as ColorPalette;
      const savedCustom = localStorage.getItem('pref-custom-palettes');
      if (savedLang) setLangState(savedLang);
      if (savedTheme) setThemeState(savedTheme);
      if (savedPalette) setColorPaletteState(savedPalette);
      if (savedCustom) {
        try {
          setCustomPalettes(JSON.parse(savedCustom));
        } catch (e) {
          console.error('Failed to parse custom palettes', e);
          setCustomPalettes(defaultPalettes);
        }
      } else {
        setCustomPalettes(defaultPalettes);
        localStorage.setItem('pref-custom-palettes', JSON.stringify(defaultPalettes));
      }
    }
  }, []);

  const setLang = (newLang: Language) => {
    setLangState(newLang);
    localStorage.setItem('pref-lang', newLang);
  };

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem('pref-theme', newTheme);
  };

  const setColorPalette = (newPalette: ColorPalette) => {
    setColorPaletteState(newPalette);
    localStorage.setItem('pref-palette', newPalette);
  };

  const addCustomPalette = (palette: CustomPalette) => {
    setCustomPalettes((prev) => {
      const updated = [...prev.filter((p) => p.id !== palette.id), palette];
      localStorage.setItem('pref-custom-palettes', JSON.stringify(updated));
      return updated;
    });
  };

  const deleteCustomPalette = (id: string) => {
    setCustomPalettes((prev) => {
      const updated = prev.filter((p) => p.id !== id);
      localStorage.setItem('pref-custom-palettes', JSON.stringify(updated));
      if (colorPalette === id) {
        const nextPalette = updated.length > 0 ? updated[0].id : 'default';
        setTimeout(() => setColorPalette(nextPalette), 0);
      }
      return updated;
    });
  };

  // Sync theme with document element attribute
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') {
      root.setAttribute('data-theme', 'system');
    } else {
      root.setAttribute('data-theme', theme);
    }
  }, [theme]);

  // Sync color palette with document element attribute & inject dynamic colors if custom
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-palette', colorPalette);

    const updateColors = () => {
      let activeTheme = theme;
      if (theme === 'system') {
        activeTheme = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }

      const palette = customPalettes.find((p) => p.id === colorPalette);
      if (palette) {
        root.style.setProperty('--primary-dark', palette.colors.primaryDark, 'important');
        root.style.setProperty('--primary-hover', palette.colors.primaryHover, 'important');
        root.style.setProperty('--primary', palette.colors.primary, 'important');
        root.style.setProperty('--primary-light', palette.colors.primaryLight, 'important');
        root.style.setProperty('--primary-lightest', palette.colors.primaryLightest, 'important');
        root.style.setProperty('--accent-dark', palette.colors.accentDark, 'important');
        root.style.setProperty('--accent-hover', palette.colors.accentHover, 'important');
        root.style.setProperty('--accent', palette.colors.accent, 'important');
        root.style.setProperty('--accent-light', palette.colors.accentLight, 'important');
        root.style.setProperty('--accent-lightest', palette.colors.accentLightest, 'important');
        
        const bg = activeTheme === 'dark' ? palette.colors.backgroundDark : palette.colors.backgroundLight;
        if (bg) {
          root.style.setProperty('--color-slate-950', bg, 'important');
        }
      } else {
        // Clear custom properties
        root.style.removeProperty('--primary-dark');
        root.style.removeProperty('--primary-hover');
        root.style.removeProperty('--primary');
        root.style.removeProperty('--primary-light');
        root.style.removeProperty('--primary-lightest');
        root.style.removeProperty('--accent-dark');
        root.style.removeProperty('--accent-hover');
        root.style.removeProperty('--accent');
        root.style.removeProperty('--accent-light');
        root.style.removeProperty('--accent-lightest');
        root.style.removeProperty('--color-slate-950');
      }
    };

    updateColors();

    if (theme === 'system' && typeof window !== 'undefined') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = () => updateColors();
      mediaQuery.addEventListener('change', listener);
      return () => mediaQuery.removeEventListener('change', listener);
    }
  }, [colorPalette, customPalettes, theme]);

  const t = (key: string, params?: Record<string, string | number>): string => {
    const dict = translations[lang] || translations['en'];
    let text = (dict as Record<string, string>)[key] || key;
    if (params) {
      Object.entries(params).forEach(([paramKey, value]) => {
        text = text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(value));
      });
    }
    return text;
  };

  return (
    <PreferencesContext.Provider
      value={{
        lang,
        theme,
        colorPalette,
        setLang,
        setTheme,
        setColorPalette,
        customPalettes,
        addCustomPalette,
        deleteCustomPalette,
        t,
      }}
    >
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error('usePreferences must be used within a PreferencesProvider');
  }
  return context;
}
