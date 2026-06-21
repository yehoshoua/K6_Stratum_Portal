'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
	Clock,
	Plus,
	Trash,
	Calendar,
	Server,
	Layers,
	ToggleLeft,
	ToggleRight,
	Play,
	AlertCircle,
	CheckCircle,
	Pencil,
	X,
} from 'lucide-react';
import { api, BatchWorkload, ClusterConfig, EcrCheck, K6Template } from '@/services/api';
import { usePreferences } from '@/components/PreferencesContext';

function sanitizeK8sName(name: string): string {
	const cleaned = name
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 52);
	return cleaned || 'k6-workload';
}

function buildCrdPayload(name: string, template: K6Template, isCron: boolean, cronExpression: string, active: boolean) {
	const payload: Record<string, unknown> = {
		name: sanitizeK8sName(name),
		scriptContent: template.script_content || '',
		resource_kind: isCron ? 'cronjob' : 'job',
		active,
		spec: {
			script: {
				configMap: {
					name: template.script_name,
					file: template.script_file || 'script.js',
				},
			},
			runner: {
				resources: {
					limits: {
						cpu: template.cpu_limit,
						memory: template.mem_limit,
					},
				},
			},
		},
	};
	if (template.runner_image) {
		(payload.spec as Record<string, unknown>).runner = {
			...(payload.spec as { runner: Record<string, unknown> }).runner,
			image: template.runner_image,
		};
	}
	if (isCron) {
		payload.cronExpression = cronExpression;
	}
	return payload;
}

function findTemplateForWorkload(workload: BatchWorkload, templates: K6Template[]): string {
	const scriptName = workload.spec?.script?.configMap?.name || '';
	const cronjobTemplates = templates.filter(t => t.template_type === 'cronjob');
	if (!scriptName) return cronjobTemplates[0]?.id || '';
	const match = cronjobTemplates.find(t => t.script_name === scriptName);
	return match?.id || cronjobTemplates[0]?.id || '';
}

export default function SchedulesPage() {
	const { t, lang } = usePreferences();
	const [workloads, setWorkloads] = useState<BatchWorkload[]>([]);
	const [clusters, setClusters] = useState<ClusterConfig[]>([]);
	const [namespaces, setNamespaces] = useState<string[]>([]);
	const [templates, setTemplates] = useState<K6Template[]>([]);

	const [filterCluster, setFilterCluster] = useState('');
	const [filterNamespace, setFilterNamespace] = useState('');

	const uniqueClusterIds = Array.from(new Set(workloads.map(w => w.cluster_id)));
	const uniqueNamespaces = Array.from(new Set(workloads.map(w => w.metadata.namespace)));

	const filteredWorkloads = workloads.filter(w => {
		if (filterCluster && w.cluster_id !== filterCluster) return false;
		if (filterNamespace && w.metadata.namespace !== filterNamespace) return false;
		return true;
	});

	const [name, setName] = useState('');
	const [clusterId, setClusterId] = useState('');
	const [namespace, setNamespace] = useState('default');
	const [templateId, setTemplateId] = useState('');
	const [cronExpr, setCronExpr] = useState('*/30 * * * *');
	const [active, setActive] = useState(true);
	const [isScheduled, setIsScheduled] = useState(true);
	const [runningKeys, setRunningKeys] = useState<string[]>([]);
	const [scheduleEcrCheck, setScheduleEcrCheck] = useState<EcrCheck | null>(null);
	const [checkingScheduleEcr, setCheckingScheduleEcr] = useState(false);

	const [editingWorkload, setEditingWorkload] = useState<BatchWorkload | null>(null);
	const [editTemplateId, setEditTemplateId] = useState('');
	const [editCronExpr, setEditCronExpr] = useState('');
	const [editActive, setEditActive] = useState(true);
	const [savingEdit, setSavingEdit] = useState(false);

	const [confirmDialog, setConfirmDialog] = useState<{
		isOpen: boolean;
		title: string;
		message: React.ReactNode;
		onConfirm: () => void | Promise<void>;
	} | null>(null);

	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');
	const [success, setSuccess] = useState('');
	const [role, setRole] = useState('viewer');

	const selectedTemplate = templates.find(tpl => tpl.id === templateId);
	const editTemplate = templates.find(tpl => tpl.id === editTemplateId);
	const cronjobTemplates = templates.filter(tpl => tpl.template_type === 'cronjob');
	const jobTemplates = templates.filter(tpl => tpl.template_type === 'job');
	const formTemplates = isScheduled ? cronjobTemplates : jobTemplates;
	const selectedCluster = clusters.find(c => c.id === clusterId);

	const workloadKey = (w: BatchWorkload) =>
		`${w.cluster_id}:${w.metadata.namespace}:${w.metadata.name}:${(w.kind || '').toLowerCase()}`;

	const loadWorkloads = useCallback(async (clusterList: ClusterConfig[]) => {
		const targetClusters = filterCluster
			? clusterList.filter(c => c.id === filterCluster)
			: clusterList;
		const all: BatchWorkload[] = [];
		let firstError: string | null = null;
		for (const cluster of targetClusters) {
			try {
				const ns = filterNamespace || 'all';
				const items = await api.getBatchWorkloads(cluster.id, ns);
				for (const item of items) {
					const kind = (item.kind || '').toLowerCase();
					if (kind === 'cronjob' || kind === 'job') {
						all.push({ ...item, cluster_id: cluster.id });
					}
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : t('scheduleLoadError');
				if (!firstError) firstError = message;
				console.error('Failed to load workloads for cluster', cluster.id, err);
			}
		}
		if (firstError && all.length === 0) {
			setError(firstError);
		}
		all.sort(
			(a, b) =>
				new Date(b.metadata.creationTimestamp).getTime() -
				new Date(a.metadata.creationTimestamp).getTime(),
		);
		setWorkloads(all);
	}, [filterCluster, filterNamespace]);

	const loadInitialData = useCallback(async () => {
		try {
			setLoading(true);
			const [clustersData, templatesData] = await Promise.all([
				api.getClusters(),
				api.getTemplates(),
			]);
			setClusters(clustersData || []);
			setTemplates(templatesData || []);
			await loadWorkloads(clustersData || []);
			if (clustersData && clustersData.length > 0) {
				setClusterId(clustersData[0].id);
				loadNamespaces(clustersData[0].id);
			}
			if (templatesData && templatesData.length > 0) {
				const defaultTemplate = templatesData.find(t => t.template_type === 'cronjob') || templatesData[0];
				setTemplateId(defaultTemplate.id);
			}
		} catch (err: unknown) {
			console.error(err);
			const message = err instanceof Error ? err.message : '';
			setError(message || t('scheduleLoadError'));
		} finally {
			setLoading(false);
		}
	}, [loadWorkloads, t]);

	useEffect(() => {
		if (typeof window !== 'undefined') {
			const storedRole = localStorage.getItem('role');
			if (storedRole) setRole(storedRole);
		}
		loadInitialData();
	}, [loadInitialData]);

	useEffect(() => {
		if (clusters.length > 0) {
			loadWorkloads(clusters);
		}
	}, [clusters, loadWorkloads]);

	useEffect(() => {
		if (formTemplates.length === 0) {
			setTemplateId('');
			return;
		}
		if (!formTemplates.some(tpl => tpl.id === templateId)) {
			setTemplateId(formTemplates[0].id);
		}
	}, [isScheduled, formTemplates, templateId]);

	const loadNamespaces = async (cId: string) => {
		try {
			const ns = await api.getNamespaces(cId);
			setNamespaces(ns || ['default']);
			setNamespace(ns?.[0] || 'default');
		} catch {
			setNamespaces(['default']);
			setNamespace('default');
		}
	};

	const handleClusterChange = (cId: string) => {
		setClusterId(cId);
		loadNamespaces(cId);
	};

	useEffect(() => {
		const runnerImage = selectedTemplate?.runner_image?.trim();
		if (!runnerImage || !clusterId) {
			setScheduleEcrCheck(null);
			setCheckingScheduleEcr(false);
			return;
		}

		let cancelled = false;
		setCheckingScheduleEcr(true);
		const timer = setTimeout(() => {
			api.checkEcrRepo(clusterId, runnerImage)
				.then((data) => {
					if (!cancelled) setScheduleEcrCheck(data);
				})
				.catch((err) => {
					if (!cancelled) {
						setScheduleEcrCheck({
							exists: false,
							repository: '',
							registry: '',
							image: runnerImage,
							message: err instanceof Error ? err.message : t('ecrCheckFailed'),
						});
					}
				})
				.finally(() => {
					if (!cancelled) setCheckingScheduleEcr(false);
				});
		}, 500);

		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [clusterId, selectedTemplate?.runner_image, t]);

	const scheduleEcrHelper = React.useMemo(() => {
		if (!scheduleEcrCheck || !selectedCluster?.region || !scheduleEcrCheck.registry || !scheduleEcrCheck.image) {
			return null;
		}
		const region = selectedCluster.region;
		const registry = scheduleEcrCheck.registry;
		const repository = scheduleEcrCheck.repository || 'xk6';
		const localImage = selectedTemplate?.runner_image || scheduleEcrCheck.image;
		return {
			login: `aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${registry}`,
			ensureRepo: `aws ecr describe-repositories --region ${region} --repository-names ${repository} || aws ecr create-repository --region ${region} --repository-name ${repository}`,
			tag: `docker tag ${localImage} ${scheduleEcrCheck.image}`,
			push: `docker push ${scheduleEcrCheck.image}`,
		};
	}, [scheduleEcrCheck, selectedCluster?.region, selectedTemplate?.runner_image]);

	const getCronFields = (expr: string) => expr.trim().split(/\s+/);

	const handleCreateWorkload = async (e: React.FormEvent) => {
		e.preventDefault();
		if (role === 'viewer') {
			setError(t('scheduleManageDenied'));
			return;
		}
		setError('');
		setSuccess('');

		const template = templates.find(tpl => tpl.id === templateId);
		if (!name || !clusterId || !namespace || !templateId || !template || (isScheduled && !cronExpr)) {
			setError(t('allFieldsRequired'));
			return;
		}
		if (isScheduled && template.template_type !== 'cronjob') {
			setError(t('templateTypeCronJobRequired'));
			return;
		}
		if (!isScheduled && template.template_type !== 'job') {
			setError(t('templateTypeJobRequired'));
			return;
		}
		if (isScheduled) {
			const fields = getCronFields(cronExpr);
			if (fields.length !== 5) {
				setError(t('cronInvalid'));
				return;
			}
		}

		try {
			setLoading(true);
			const payload = buildCrdPayload(name, template, isScheduled, cronExpr, active && isScheduled);
			await api.createCRD(clusterId, namespace, payload);
			await loadWorkloads(clusters);
			setSuccess(t('scheduleCreateSuccess'));
			setName('');
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : '';
			setError(message || t('scheduleCreateFailed'));
		} finally {
			setLoading(false);
		}
	};

	const handleEditClick = (workload: BatchWorkload) => {
		if ((workload.kind || '').toLowerCase() !== 'cronjob') return;
		setEditingWorkload(workload);
		setEditTemplateId(findTemplateForWorkload(workload, templates));
		setEditCronExpr(workload.spec?.schedule || '');
		setEditActive(workload.status?.active !== false);
	};

	const handleSaveEdit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!editingWorkload || role === 'viewer') return;

		const template = cronjobTemplates.find(tpl => tpl.id === editTemplateId);
		if (!template || !editCronExpr.trim()) {
			setError(t('allFieldsRequired'));
			return;
		}
		const fields = getCronFields(editCronExpr);
		if (fields.length !== 5) {
			setError(t('cronInvalid'));
			return;
		}

		try {
			setSavingEdit(true);
			setError('');
			const payload = buildCrdPayload(
				editingWorkload.metadata.name,
				template,
				true,
				editCronExpr,
				editActive,
			);
			await api.createCRD(
				editingWorkload.cluster_id,
				editingWorkload.metadata.namespace,
				payload,
			);
			await loadWorkloads(clusters);
			setEditingWorkload(null);
			setSuccess(t('workloadUpdateSuccess'));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : '';
			setError(message || t('workloadUpdateFailed'));
		} finally {
			setSavingEdit(false);
		}
	};

	const requestConfirm = (title: string, message: React.ReactNode, onConfirm: () => void | Promise<void>) => {
		setConfirmDialog({
			isOpen: true,
			title,
			message,
			onConfirm: async () => {
				setConfirmDialog(null);
				await onConfirm();
			},
		});
	};

	const handleRunWorkload = async (workload: BatchWorkload) => {
		if (role === 'viewer') {
			setError(t('scheduleRunDenied'));
			return;
		}
		const template = templates.find(tpl => {
			const scriptName = workload.spec?.script?.configMap?.name || '';
			return tpl.script_name === scriptName;
		}) || templates[0];
		if (!template) {
			setError(t('allFieldsRequired'));
			return;
		}

		const key = workloadKey(workload);
		setError('');
		setSuccess('');
		try {
			setRunningKeys(prev => [...prev, key]);
			const runName = `${workload.metadata.name}-run-${Date.now()}`.slice(0, 52);
			const payload = buildCrdPayload(runName, template, false, '', true);
			await api.createCRD(workload.cluster_id, workload.metadata.namespace, payload);
			await loadWorkloads(clusters);
			setSuccess(t('jobTriggeredSuccess'));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : '';
			setError(message || t('scheduleTriggerFailed'));
		} finally {
			setRunningKeys(prev => prev.filter(x => x !== key));
		}
	};

	const handleToggleWorkload = async (workload: BatchWorkload) => {
		if (role === 'viewer') {
			setError(t('scheduleManageDenied'));
			return;
		}
		if ((workload.kind || '').toLowerCase() !== 'cronjob') return;

		setError('');
		setSuccess('');
		try {
			const updated = await api.toggleBatchCronJob(
				workload.cluster_id,
				workload.metadata.name,
				workload.metadata.namespace,
			);
			setWorkloads(prev =>
				prev.map(w =>
					workloadKey(w) === workloadKey(workload)
						? { ...w, ...updated, cluster_id: workload.cluster_id }
						: w,
				),
			);
			setSuccess(
				updated.status?.active ? t('scheduleResumedSuccess') : t('schedulePausedSuccess'),
			);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : '';
			setError(message || t('scheduleToggleFailed'));
		}
	};

	const handleDeleteWorkload = (workload: BatchWorkload) => {
		if (role === 'viewer') {
			setError(t('scheduleManageDenied'));
			return;
		}
		requestConfirm(
			t('deleteWorkloadTitle'),
			<span>{t('deleteWorkloadConfirm', { name: workload.metadata.name })}</span>,
			async () => {
				try {
					setLoading(true);
					await api.deleteCRD(
						workload.cluster_id,
						workload.metadata.name,
						workload.metadata.namespace,
					);
					await loadWorkloads(clusters);
					setSuccess(t('workloadDeleteSuccess'));
				} catch (err: unknown) {
					const message = err instanceof Error ? err.message : '';
					setError(message || t('workloadDeleteFailed'));
				} finally {
					setLoading(false);
				}
			},
		);
	};

	const getClusterName = (id: string) => clusters.find(c => c.id === id)?.name || id;

	const isCronJob = (w: BatchWorkload) => (w.kind || '').toLowerCase() === 'cronjob';

	return (
		<div className="space-y-8 animate-fadeIn text-slate-100" dir={lang === 'he' ? 'rtl' : 'ltr'}>
			<div>
				<h2 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
					<Clock className="w-8 h-8 text-purple-400" />
					<span>{t('schedules')}</span>
				</h2>
				<p className="text-slate-400 text-sm mt-1">{t('schedulesSub')}</p>
			</div>

			{error && (
				<div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-2xl flex items-center space-x-3 text-xs">
					<AlertCircle className="w-5 h-5 shrink-0" />
					<span>{error}</span>
				</div>
			)}
			{success && (
				<div className="p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-2xl flex items-center space-x-3 text-xs">
					<CheckCircle className="w-5 h-5 shrink-0" />
					<span>{success}</span>
				</div>
			)}

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
				{role !== 'viewer' && (
					<div className="bg-slate-900/30 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md space-y-5">
						<h3 className="text-lg font-bold text-white flex items-center gap-2">
							<Plus className="w-5 h-5 text-purple-400" />
							<span>{t('newSchedule')}</span>
						</h3>

						<form onSubmit={handleCreateWorkload} className="space-y-4 text-xs">
							<div className="space-y-1">
								<label className="text-slate-400 font-medium">{t('scheduleName')}</label>
								<input
									type="text"
									placeholder={t('scheduleNamePlaceholder')}
									value={name}
									onChange={(e) => setName(e.target.value)}
									className="w-full bg-slate-950/80 border border-slate-850 text-slate-200 px-3 py-2 rounded-xl outline-none focus:border-purple-500/50 transition"
								/>
							</div>

							<div className="space-y-1">
								<label className="text-slate-400 font-medium">{t('clusterLabel')}</label>
								<select
									value={clusterId}
									onChange={(e) => handleClusterChange(e.target.value)}
									className="w-full bg-slate-950/80 border border-slate-850 text-slate-200 px-3 py-2 rounded-xl outline-none focus:border-purple-500/50 transition cursor-pointer"
								>
									{clusters.map(c => (
										<option key={c.id} value={c.id}>{c.name}</option>
									))}
								</select>
							</div>

							<div className="space-y-1">
								<label className="text-slate-400 font-medium">{t('namespaceLabel')}</label>
								<select
									value={namespace}
									onChange={(e) => setNamespace(e.target.value)}
									className="w-full bg-slate-950/80 border border-slate-850 text-slate-200 px-3 py-2 rounded-xl outline-none focus:border-purple-500/50 transition cursor-pointer"
								>
									{namespaces.map(ns => (
										<option key={ns} value={ns}>{ns}</option>
									))}
								</select>
							</div>

							<div className="space-y-1">
								<label className="text-slate-400 font-medium">{t('k6Template')}</label>
								<select
									value={templateId}
									onChange={(e) => setTemplateId(e.target.value)}
									className="w-full bg-slate-950/80 border border-slate-850 text-slate-200 px-3 py-2 rounded-xl outline-none focus:border-purple-500/50 transition cursor-pointer"
								>
									{formTemplates.map(tpl => (
										<option key={tpl.id} value={tpl.id}>{tpl.name}</option>
									))}
								</select>
							</div>

							{selectedTemplate?.runner_image && (
								<div className="bg-slate-950/70 border border-slate-850 rounded-xl p-3 space-y-2">
									<div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">{t('runnerImage')}</div>
									<p className="text-[11px] text-slate-300 font-mono break-all">{selectedTemplate.runner_image}</p>
									{checkingScheduleEcr && (
										<p className="text-[10px] text-slate-500">{t('checkingEcrRepo')}</p>
									)}
									{!checkingScheduleEcr && scheduleEcrCheck && (
										<div className={`text-[10px] ${scheduleEcrCheck.exists ? 'text-emerald-400' : 'text-amber-400'}`}>
											{scheduleEcrCheck.exists ? t('ecrRepoFound') : t('ecrRepoNotFound')}
											{scheduleEcrCheck.message && (
												<span className="text-slate-500 ml-2">{scheduleEcrCheck.message}</span>
											)}
										</div>
									)}
									{scheduleEcrHelper && (
										<div className="space-y-1 text-[10px] text-slate-400 font-mono">
											<pre className="whitespace-pre-wrap">{scheduleEcrHelper.login}</pre>
											<pre className="whitespace-pre-wrap">{scheduleEcrHelper.ensureRepo}</pre>
											<pre className="whitespace-pre-wrap">{scheduleEcrHelper.tag}</pre>
											<pre className="whitespace-pre-wrap">{scheduleEcrHelper.push}</pre>
										</div>
									)}
								</div>
							)}

							<div className="flex items-center justify-between pt-2">
								<span className="text-slate-400 font-medium">{t('runOnSchedule')}</span>
								<input
									type="checkbox"
									checked={isScheduled}
									onChange={(e) => setIsScheduled(e.target.checked)}
									className="accent-purple-500 rounded border-slate-800 cursor-pointer"
								/>
							</div>

							{isScheduled && (
								<div className="space-y-1 animate-fadeIn">
									<label className="text-slate-400 font-medium">{t('cronExpression')}</label>
									<input
										type="text"
										placeholder="*/30 * * * *"
										value={cronExpr}
										onChange={(e) => setCronExpr(e.target.value)}
										className="w-full bg-slate-950/80 border border-slate-850 text-slate-200 px-3 py-2 rounded-xl outline-none focus:border-purple-500/50 transition font-mono"
									/>
									<p className="text-[10px] text-slate-500">{t('cronFormatHint')}</p>
								</div>
							)}

							{isScheduled && (
								<div className="flex items-center justify-between pt-2">
									<span className="text-slate-400 font-medium">{t('activeStatus')}</span>
									<button
										type="button"
										onClick={() => setActive(prev => !prev)}
										className="text-purple-400 hover:text-purple-300 transition outline-none cursor-pointer"
									>
										{active ? (
											<ToggleRight className="w-8 h-8" />
										) : (
											<ToggleLeft className="w-8 h-8 text-slate-600" />
										)}
									</button>
								</div>
							)}

							<button
								type="submit"
								disabled={loading}
								className="w-full bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-500 hover:to-pink-400 text-white font-bold py-2.5 rounded-xl transition shadow-lg shadow-purple-500/10 cursor-pointer text-xs"
							>
								{loading ? t('saving') : (isScheduled ? t('addScheduleCronJob') : t('runTestJob'))}
							</button>
						</form>
					</div>
				)}

				<div className={`lg:col-span-2 bg-slate-900/30 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md space-y-4 ${role === 'viewer' ? 'lg:col-span-3' : ''}`}>
					<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
						<h3 className="text-lg font-bold text-white flex items-center gap-2">
							<Calendar className="w-5 h-5 text-purple-400" />
							<span>{t('scheduledTasks')}</span>
						</h3>

						<div className="flex items-center gap-2 text-[11px]">
							<select
								value={filterCluster}
								onChange={(e) => setFilterCluster(e.target.value)}
								className="bg-slate-950/80 border border-slate-850 text-slate-300 hover:text-white px-2.5 py-1.5 rounded-xl outline-none focus:border-purple-500/50 transition cursor-pointer"
							>
								<option value="">{t('allClusters')}</option>
								{uniqueClusterIds.map(cId => (
									<option key={cId} value={cId}>{getClusterName(cId)}</option>
								))}
							</select>
							<select
								value={filterNamespace}
								onChange={(e) => setFilterNamespace(e.target.value)}
								className="bg-slate-950/80 border border-slate-850 text-slate-300 hover:text-white px-2.5 py-1.5 rounded-xl outline-none focus:border-purple-500/50 transition cursor-pointer"
							>
								<option value="">{t('allNamespaces')}</option>
								{uniqueNamespaces.map(ns => (
									<option key={ns} value={ns}>{ns}</option>
								))}
							</select>
						</div>
					</div>

					{loading && workloads.length === 0 ? (
						<div className="py-12 text-slate-500 text-center text-xs">{t('loadingSchedules')}</div>
					) : filteredWorkloads.length === 0 ? (
						<div className="py-12 text-slate-500 text-center text-xs">
							{workloads.length === 0
								? t('noSchedulesConfigured')
								: t('noSchedulesMatchFilters')}
						</div>
					) : (
						<div className="space-y-4 overflow-y-auto max-h-[600px] pr-1">
							{filteredWorkloads.map((workload) => {
								const key = workloadKey(workload);
								const cron = isCronJob(workload);
								const isActive = workload.status?.active !== false;
								return (
									<div
										key={key}
										className="p-4 bg-slate-950/20 border border-slate-850 rounded-2xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 hover:border-slate-800 transition duration-300"
									>
										<div className="space-y-2 min-w-0">
											<div className="flex items-center gap-2 flex-wrap">
												<span className="font-semibold text-sm text-white truncate">{workload.metadata.name}</span>
												<span className="px-2 py-0.5 rounded-md text-[9px] font-bold border bg-slate-800/55 text-slate-400 border-slate-800 uppercase">
													{cron ? t('cronJobLabel') : t('jobLabel')}
												</span>
												{cron && (
													<span className={`px-2 py-0.5 rounded-md text-[9px] font-bold border ${
														isActive
															? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
															: 'bg-slate-800/55 text-slate-500 border-slate-800'
													}`}>
														{isActive ? t('active') : t('inactive')}
													</span>
												)}
											</div>

											<div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-[10px] text-slate-400">
												<div className="flex items-center gap-1">
													<Server className="w-3.5 h-3.5 text-slate-500 shrink-0" />
													<span className="truncate">{getClusterName(workload.cluster_id)}</span>
												</div>
												<div className="flex items-center gap-1">
													<Layers className="w-3.5 h-3.5 text-slate-500 shrink-0" />
													<span className="truncate">{workload.metadata.namespace}</span>
												</div>
												<div className="flex items-center gap-1 col-span-2 sm:col-span-1">
													<Play className="w-3.5 h-3.5 text-slate-500 shrink-0" />
													<span className="truncate">{workload.spec?.script?.configMap?.name || '—'}</span>
												</div>
											</div>

											{cron && workload.spec?.schedule ? (
												<div className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
													<Clock className="w-3.5 h-3.5 text-slate-600 shrink-0" />
													<span>{t('cronLabel')} {workload.spec.schedule}</span>
												</div>
											) : (
												<div className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
													<Play className="w-3.5 h-3.5 text-slate-600 shrink-0" />
													<span>{t('oneOffExecution')}</span>
												</div>
											)}
										</div>

										{role !== 'viewer' && (
											<div className="flex items-center space-x-2 shrink-0">
												{cron && (
													<button
														onClick={() => handleEditClick(workload)}
														className="p-2 border border-slate-850 hover:bg-purple-500/10 text-slate-500 hover:text-purple-400 rounded-xl transition cursor-pointer self-start sm:self-center"
														title={t('editSchedule')}
													>
														<Pencil className="w-4 h-4" />
													</button>
												)}
												<button
													onClick={() => handleRunWorkload(workload)}
													disabled={runningKeys.includes(key)}
													className="p-2 border border-slate-850 hover:bg-emerald-500/10 text-slate-500 hover:text-emerald-400 rounded-xl transition cursor-pointer self-start sm:self-center disabled:opacity-50"
													title={t('runScheduleNow')}
												>
													<Play className="w-4 h-4" />
												</button>
												{cron && (
													<button
														onClick={() => handleToggleWorkload(workload)}
														className={`p-2 border border-slate-850 rounded-xl transition cursor-pointer self-start sm:self-center ${
															isActive
																? 'hover:bg-purple-500/10 text-purple-400'
																: 'hover:bg-slate-800 text-slate-500'
														}`}
														title={isActive ? t('pauseSchedule') : t('resumeSchedule')}
													>
														{isActive ? (
															<ToggleRight className="w-4 h-4" />
														) : (
															<ToggleLeft className="w-4 h-4 text-slate-500" />
														)}
													</button>
												)}
												<button
													onClick={() => handleDeleteWorkload(workload)}
													className="p-2 border border-slate-850 hover:bg-red-500/10 text-slate-500 hover:text-red-400 rounded-xl transition cursor-pointer self-start sm:self-center"
													title={t('deleteWorkloadTitle')}
												>
													<Trash className="w-4 h-4" />
												</button>
											</div>
										)}
									</div>
								);
							})}
						</div>
					)}
				</div>
			</div>

			{editingWorkload && (
				<div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
					<div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md p-6 shadow-2xl relative">
						<button
							type="button"
							onClick={() => setEditingWorkload(null)}
							className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 p-1 cursor-pointer"
						>
							<X className="w-5 h-5" />
						</button>

						<h3 className="text-xl font-bold text-white mb-1">{t('editScheduleTitle')}</h3>
						<p className="text-slate-500 text-xs mb-4 font-mono">{editingWorkload.metadata.name}</p>

						<form onSubmit={handleSaveEdit} className="space-y-4 text-xs">
							<div className="space-y-1">
								<label className="text-slate-400 font-medium">{t('k6Template')}</label>
								<select
									value={editTemplateId}
									onChange={(e) => setEditTemplateId(e.target.value)}
									className="w-full bg-slate-950/80 border border-slate-850 text-slate-200 px-3 py-2 rounded-xl outline-none focus:border-purple-500/50 transition cursor-pointer"
								>
									{cronjobTemplates.map(tpl => (
										<option key={tpl.id} value={tpl.id}>{tpl.name}</option>
									))}
								</select>
							</div>

							<div className="space-y-1">
								<label className="text-slate-400 font-medium">{t('cronExpression')}</label>
								<input
									type="text"
									value={editCronExpr}
									onChange={(e) => setEditCronExpr(e.target.value)}
									className="w-full bg-slate-950/80 border border-slate-850 text-slate-200 px-3 py-2 rounded-xl outline-none focus:border-purple-500/50 transition font-mono"
								/>
								<p className="text-[10px] text-slate-500">{t('cronFormatHint')}</p>
							</div>

							<div className="flex items-center justify-between">
								<span className="text-slate-400 font-medium">{t('activeStatus')}</span>
								<button
									type="button"
									onClick={() => setEditActive(prev => !prev)}
									className="text-purple-400 hover:text-purple-300 transition outline-none cursor-pointer"
								>
									{editActive ? (
										<ToggleRight className="w-8 h-8" />
									) : (
										<ToggleLeft className="w-8 h-8 text-slate-600" />
									)}
								</button>
							</div>

							<div className="flex space-x-3 pt-2">
								<button
									type="button"
									onClick={() => setEditingWorkload(null)}
									className="flex-1 py-2 border border-slate-850 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
								>
									{t('cancel')}
								</button>
								<button
									type="submit"
									disabled={savingEdit}
									className="flex-1 py-2 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-xs font-semibold shadow-lg transition cursor-pointer disabled:opacity-50"
								>
									{savingEdit ? t('saving') : t('saveChanges')}
								</button>
							</div>
						</form>
					</div>
				</div>
			)}

			{confirmDialog?.isOpen && (
				<div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
					<div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-sm p-6 shadow-2xl space-y-4">
						<h3 className="text-lg font-bold text-slate-100">{confirmDialog.title}</h3>
						<p className="text-slate-400 text-xs leading-normal">{confirmDialog.message}</p>
						<div className="flex space-x-3 pt-2">
							<button
								onClick={() => setConfirmDialog(null)}
								className="flex-1 py-2 border border-slate-850 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
							>
								{t('cancel')}
							</button>
							<button
								onClick={confirmDialog.onConfirm}
								className="flex-1 py-2 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-xs font-semibold shadow-lg transition cursor-pointer hover:from-purple-500 hover:to-pink-400"
							>
								{t('confirm')}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
