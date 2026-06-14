package k8s

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	yaml "gopkg.in/yaml.v3"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

func init() {
	rest.SetDefaultWarningHandler(rest.NoWarnings{})
}

// EKSClusterClient houses clientsets required to interact with Amazon EKS
type EKSClusterClient struct {
	Clientset     kubernetes.Interface
	DynamicClient dynamic.Interface
}

// LocalContextInfo holds the information parsed from a local kubeconfig context
type LocalContextInfo struct {
	ContextName  string `json:"context_name"`
	ClusterName  string `json:"cluster_name"`
	APIServerURL string `json:"api_server_url"`
	IsCurrent    bool   `json:"is_current"`
}

// GetLocalContexts parses the local kubeconfig ($HOME/.kube/.config or $HOME/.kube/config)
// and returns all available contexts along with the current context name.
func GetLocalContexts() ([]LocalContextInfo, string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, "", fmt.Errorf("failed to get user home directory: %w", err)
	}

	paths := []string{
		filepath.Join(home, ".kube", ".config"),
		filepath.Join(home, ".kube", "config"),
	}

	var kubeconfigPath string
	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			kubeconfigPath = p
			break
		}
	}

	if kubeconfigPath == "" {
		return nil, "", fmt.Errorf("kubeconfig file not found in ~/.kube/.config or ~/.kube/config")
	}

	config, err := clientcmd.LoadFromFile(kubeconfigPath)
	if err != nil {
		return nil, "", fmt.Errorf("failed to load kubeconfig: %w", err)
	}

	var list []LocalContextInfo
	for name, ctx := range config.Contexts {
		info := LocalContextInfo{
			ContextName: name,
			ClusterName: ctx.Cluster,
			IsCurrent:   name == config.CurrentContext,
		}
		// Resolve API Server URL
		if cluster, ok := config.Clusters[ctx.Cluster]; ok {
			info.APIServerURL = cluster.Server
		}
		list = append(list, info)
	}

	return list, config.CurrentContext, nil
}

// NewClientFromLocalKubeconfig initializes EKSClusterClient from the local kubeconfig file
// using a specified context name (or current-context if contextName is empty).
func NewClientFromLocalKubeconfig(contextName string) (*EKSClusterClient, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("failed to get user home directory: %w", err)
	}

	paths := []string{
		filepath.Join(home, ".kube", ".config"),
		filepath.Join(home, ".kube", "config"),
	}

	var kubeconfigPath string
	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			kubeconfigPath = p
			break
		}
	}

	if kubeconfigPath == "" {
		return nil, fmt.Errorf("kubeconfig file not found in ~/.kube/.config or ~/.kube/config")
	}

	loader := &clientcmd.ClientConfigLoadingRules{ExplicitPath: kubeconfigPath}
	overrides := &clientcmd.ConfigOverrides{}
	if contextName != "" {
		overrides.CurrentContext = contextName
	}

	clientConfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loader, overrides)
	config, err := clientConfig.ClientConfig()
	if err != nil {
		return nil, fmt.Errorf("failed to load kubeconfig client config: %w", err)
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create standard clientset: %w", err)
	}

	dynClient, err := dynamic.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create dynamic client: %w", err)
	}

	return &EKSClusterClient{
		Clientset:     clientset,
		DynamicClient: dynClient,
	}, nil
}

// NewClientFromKubeconfig initializes clients using a raw Kubeconfig file
func NewClientFromKubeconfig(kubeconfigPEM []byte) (*EKSClusterClient, error) {
	cleanedPEM, err := cleanKubeconfig(kubeconfigPEM)
	if err == nil {
		kubeconfigPEM = cleanedPEM
	}
	config, err := clientcmd.RESTConfigFromKubeConfig(kubeconfigPEM)
	if err != nil {
		return nil, fmt.Errorf("failed to parse kubeconfig: %w", err)
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create standard clientset: %w", err)
	}

	dynClient, err := dynamic.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create dynamic client: %w", err)
	}

	return &EKSClusterClient{
		Clientset:     clientset,
		DynamicClient: dynClient,
	}, nil
}

// NewClientFromToken initializes connection using a Service Account token and CA Cert
func NewClientFromToken(apiServerURL string, token string, caCertBase64 string) (*EKSClusterClient, error) {
	caCert, err := base64.StdEncoding.DecodeString(caCertBase64)
	if err != nil {
		return nil, fmt.Errorf("failed to base64 decode CA certificate: %w", err)
	}

	config := &rest.Config{
		Host:        apiServerURL,
		BearerToken: token,
		TLSClientConfig: rest.TLSClientConfig{
			CAData: caCert,
		},
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, err
	}

	dynClient, err := dynamic.NewForConfig(config)
	if err != nil {
		return nil, err
	}

	return &EKSClusterClient{
		Clientset:     clientset,
		DynamicClient: dynClient,
	}, nil
}

// NewClientFromInCluster initializes clients using in-cluster ServiceAccount token
func NewClientFromInCluster() (*EKSClusterClient, error) {
	config, err := rest.InClusterConfig()
	if err != nil {
		return nil, fmt.Errorf("failed to load in-cluster config: %w", err)
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create standard clientset: %w", err)
	}

	dynClient, err := dynamic.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create dynamic client: %w", err)
	}

	return &EKSClusterClient{
		Clientset:     clientset,
		DynamicClient: dynClient,
	}, nil
}


// GetK6GVR returns the schema GVR for the legacy K6 CRD (k6s.k6.io)
func GetK6GVR() schema.GroupVersionResource {
	return schema.GroupVersionResource{
		Group:    "k6.io",
		Version:  "v1alpha1",
		Resource: "k6s",
	}
}

// GetK6TestRunGVR returns the schema GVR for the new TestRun CRD (testruns.k6.io)
func GetK6TestRunGVR() schema.GroupVersionResource {
	return schema.GroupVersionResource{
		Group:    "k6.io",
		Version:  "v1alpha1",
		Resource: "testruns",
	}
}

// ListK6CustomResources fetches all k6 Custom Resources in the given namespace, supporting both old and new CRDs
func (c *EKSClusterClient) ListK6CustomResources(ctx context.Context, namespace string) ([]unstructured.Unstructured, error) {
	// Try the new testruns.k6.io resource first
	list, err := c.DynamicClient.Resource(GetK6TestRunGVR()).Namespace(namespace).List(ctx, metav1.ListOptions{})
	if err == nil {
		return list.Items, nil
	}

	// Fallback to legacy k6s.k6.io
	errStr := err.Error()
	if apierrors.IsNotFound(err) ||
		strings.Contains(errStr, "could not find the requested resource") ||
		strings.Contains(errStr, "no matches for kind") {
		
		legacyList, legacyErr := c.DynamicClient.Resource(GetK6GVR()).Namespace(namespace).List(ctx, metav1.ListOptions{})
		if legacyErr == nil {
			return legacyList.Items, nil
		}

		legacyErrStr := legacyErr.Error()
		if apierrors.IsNotFound(legacyErr) ||
			strings.Contains(legacyErrStr, "could not find the requested resource") ||
			strings.Contains(legacyErrStr, "no matches for kind") {
			return []unstructured.Unstructured{}, nil
		}
		return nil, fmt.Errorf("failed to list legacy K6 Custom Resources: %w", legacyErr)
	}

	return nil, fmt.Errorf("failed to list K6 TestRun Resources: %w", err)
}

// GetK6CustomResource fetches a specific K6 custom resource by name
func (c *EKSClusterClient) GetK6CustomResource(ctx context.Context, namespace, name string) (*unstructured.Unstructured, error) {
	// Try the new testruns resource
	item, err := c.DynamicClient.Resource(GetK6TestRunGVR()).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
	if err == nil {
		return item, nil
	}

	// Fallback to legacy k6s
	errStr := err.Error()
	if apierrors.IsNotFound(err) ||
		strings.Contains(errStr, "could not find the requested resource") ||
		strings.Contains(errStr, "no matches for kind") {
		
		legacyItem, legacyErr := c.DynamicClient.Resource(GetK6GVR()).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
		if legacyErr != nil {
			return nil, fmt.Errorf("failed to get legacy K6 Custom Resource %s: %w", name, legacyErr)
		}
		return legacyItem, nil
	}

	return nil, fmt.Errorf("failed to get K6 Custom Resource %s: %w", name, err)
}

// CreateK6CustomResource creates a new K6 Custom Resource (automatically adapting Kind to TestRun or K6)
func (c *EKSClusterClient) CreateK6CustomResource(ctx context.Context, namespace string, obj *unstructured.Unstructured) (*unstructured.Unstructured, error) {
	// Try creating as a TestRun first
	obj.SetKind("TestRun")
	created, err := c.DynamicClient.Resource(GetK6TestRunGVR()).Namespace(namespace).Create(ctx, obj, metav1.CreateOptions{})
	if err == nil {
		return created, nil
	}

	// Fallback to legacy K6 kind
	errStr := err.Error()
	if apierrors.IsNotFound(err) ||
		strings.Contains(errStr, "could not find the requested resource") ||
		strings.Contains(errStr, "no matches for kind") {
		
		obj.SetKind("K6")
		legacyCreated, legacyErr := c.DynamicClient.Resource(GetK6GVR()).Namespace(namespace).Create(ctx, obj, metav1.CreateOptions{})
		if legacyErr != nil {
			return nil, fmt.Errorf("failed to create legacy K6 Custom Resource: %w", legacyErr)
		}
		return legacyCreated, nil
	}

	return nil, fmt.Errorf("failed to create K6 Custom Resource: %w", err)
}

// DeleteK6CustomResource deletes a specific K6 Custom Resource
func (c *EKSClusterClient) DeleteK6CustomResource(ctx context.Context, namespace, name string) error {
	// Try deleting new testruns resource
	err := c.DynamicClient.Resource(GetK6TestRunGVR()).Namespace(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	if err == nil {
		return nil
	}

	// Fallback to legacy k6s
	errStr := err.Error()
	if apierrors.IsNotFound(err) ||
		strings.Contains(errStr, "could not find the requested resource") ||
		strings.Contains(errStr, "no matches for kind") {
		
		legacyErr := c.DynamicClient.Resource(GetK6GVR()).Namespace(namespace).Delete(ctx, name, metav1.DeleteOptions{})
		if legacyErr != nil {
			return fmt.Errorf("failed to delete legacy K6 Custom Resource %s: %w", name, legacyErr)
		}
		return nil
	}

	return fmt.Errorf("failed to delete K6 Custom Resource %s: %w", name, err)
}

// cleanKubeconfig parses the kubeconfig raw data and removes duplicate entries from clusters, contexts, and users list
func cleanKubeconfig(data []byte) ([]byte, error) {
	var raw map[string]interface{}
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return data, err
	}

	deduplicate := func(key string) {
		listVal, ok := raw[key].([]interface{})
		if !ok {
			return
		}
		seen := make(map[string]bool)
		uniqueList := make([]interface{}, 0)
		for _, item := range listVal {
			itemMap, ok := item.(map[string]interface{})
			if !ok {
				uniqueList = append(uniqueList, item)
				continue
			}
			name, ok := itemMap["name"].(string)
			if !ok {
				uniqueList = append(uniqueList, item)
				continue
			}
			if !seen[name] {
				seen[name] = true
				uniqueList = append(uniqueList, item)
			}
		}
		raw[key] = uniqueList
	}

	deduplicate("clusters")
	deduplicate("contexts")
	deduplicate("users")

	cleaned, err := yaml.Marshal(raw)
	if err != nil {
		return data, err
	}
	return cleaned, nil
}
