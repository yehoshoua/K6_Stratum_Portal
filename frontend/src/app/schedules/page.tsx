'use client';

import React, { useEffect, useState } from 'react';
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
	CheckCircle
} from 'lucide-react';
import { api, ClusterConfig, K6Template, TestSchedule } from '@/services/api';
import { usePreferences } from '@/components/PreferencesContext';

export default function SchedulesPage() {
	const { t } = usePreferences();
	const [schedules, setSchedules] = useState<TestSchedule[]>([]);
	const [clusters, setClusters] = useState<ClusterConfig[]>([]);
	const [namespaces, setNamespaces] = useState<string[]>([]);
	const [templates, setTemplates] = useState<K6Template[]>([]);

	// Filter States
	const [filterCluster, setFilterCluster] = useState('');
	const [filterNamespace, setFilterNamespace] = useState('');

	// Extract unique values from scheduled tasks (with cron expressions)
	const uniqueClusterIds = Array.from(new Set(schedules.filter(s => !!s.cron_expression).map(s => s.cluster_id)));
	const uniqueNamespaces = Array.from(new Set(schedules.filter(s => !!s.cron_expression).map(s => s.namespace)));

	// Filter schedules to only show scheduled tasks/cronjobs matching the filters
	const filteredSchedules = schedules.filter(sched => {
		// Only display scheduled jobs/cronjobs (i.e. with cron_expression)
		if (!sched.cron_expression) return false;
		
		if (filterCluster && sched.cluster_id !== filterCluster) return false;
		if (filterNamespace && sched.namespace !== filterNamespace) return false;
		
		return true;
	});

	// Form States
	const [name, setName] = useState('');
	const [clusterId, setClusterId] = useState('');
	const [namespace, setNamespace] = useState('default');
	const [templateId, setTemplateId] = useState('');
	const [cronExpr, setCronExpr] = useState('*/30 * * * *');
	const [active, setActive] = useState(true);
	const [isScheduled, setIsScheduled] = useState(true);
	const [runningIds, setRunningIds] = useState<number[]>([]);
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

	useEffect(() => {
		if (typeof window !== 'undefined') {
			const storedRole = localStorage.getItem('role');
			if (storedRole) setRole(storedRole);
		}
		loadInitialData();
	}, []);

	const loadInitialData = async () => {
		try {
			setLoading(true);
			const [schedsData, clustersData, templatesData] = await Promise.all([
				api.getSchedules(),
				api.getClusters(),
				api.getTemplates()
			]);
			setSchedules(schedsData || []);
			setClusters(clustersData || []);
			setTemplates(templatesData || []);
			if (clustersData && clustersData.length > 0) {
				setClusterId(clustersData[0].id);
				loadNamespaces(clustersData[0].id);
			}
			if (templatesData && templatesData.length > 0) {
				setTemplateId(templatesData[0].id);
			}
		} catch (err: any) {
			console.error(err);
			setError(err.message || 'Failed to load scheduler data');
		} finally {
			setLoading(false);
		}
	};

	const loadNamespaces = async (cId: string) => {
		try {
			const ns = await api.getNamespaces(cId);
			setNamespaces(ns || ['default']);
			setNamespace(ns?.[0] || 'default');
		} catch (err) {
			setNamespaces(['default']);
			setNamespace('default');
		}
	};

	const handleClusterChange = (cId: string) => {
		setClusterId(cId);
		loadNamespaces(cId);
	};

	const handleCreateSchedule = async (e: React.FormEvent) => {
		e.preventDefault();
		if (role === 'viewer') {
			setError('Only editors and administrators can manage schedules');
			return;
		}
		setError('');
		setSuccess('');

		if (!name || !clusterId || !namespace || !templateId || (isScheduled && !cronExpr)) {
			setError('All fields are required');
			return;
		}

		try {
			setLoading(true);
			const newSched = await api.createSchedule({
				name,
				cluster_id: clusterId,
				namespace,
				template_id: templateId,
				cron_expression: isScheduled ? cronExpr : '',
				active: active && isScheduled
			});
			setSchedules(prev => [newSched, ...prev]);
			setSuccess('Schedule created successfully');
			setName('');
		} catch (err: any) {
			setError(err.message || 'Failed to create schedule');
		} finally {
			setLoading(false);
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
			}
		});
	};

	const handleRunSchedule = async (id: number) => {
		if (role === 'viewer') {
			setError('Only editors and administrators can run schedules');
			return;
		}
		setError('');
		setSuccess('');
		try {
			setRunningIds(prev => [...prev, id]);
			await api.runSchedule(id);
			setSuccess('Job triggered successfully!');
		} catch (err: any) {
			setError(err.message || 'Failed to trigger schedule');
		} finally {
			setRunningIds(prev => prev.filter(x => x !== id));
		}
	};

	const handleToggleSchedule = async (id: number) => {
		if (role === 'viewer') {
			setError('Only editors and administrators can manage schedules');
			return;
		}
		setError('');
		setSuccess('');
		try {
			const updated = await api.toggleSchedule(id);
			setSchedules(prev => prev.map(s => s.id === id ? { ...s, active: updated.active } : s));
			setSuccess(`Schedule ${updated.active ? 'resumed' : 'paused'} successfully`);
		} catch (err: any) {
			setError(err.message || 'Failed to toggle schedule status');
		}
	};

	const handleDeleteSchedule = (id: number, name: string) => {
		if (role === 'viewer') {
			setError('Only editors and administrators can manage schedules');
			return;
		}
		requestConfirm(
			'Delete Schedule',
			<span>Are you sure you want to delete "<strong className="font-semibold text-slate-200">{name}</strong>"?</span>,
			async () => {
				try {
					setLoading(true);
					await api.deleteSchedule(id);
					setSchedules(prev => prev.filter(s => s.id !== id));
					setSuccess('Schedule deleted successfully');
				} catch (err: any) {
					setError(err.message || 'Failed to delete schedule');
				} finally {
					setLoading(false);
				}
			}
		);
	};

	const getClusterName = (id: string) => {
		return clusters.find(c => c.id === id)?.name || id;
	};

	const getTemplateName = (id: string) => {
		return templates.find(t => t.id === id)?.name || id;
	};

	return (
		<div className="space-y-8 animate-fadeIn text-slate-100">
			{/* Header */}
			<div>
				<h2 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
					<Clock className="w-8 h-8 text-purple-400" />
					<span>{t('schedules')}</span>
				</h2>
				<p className="text-slate-400 text-sm mt-1">
					Automate performance testing schedules by defining Cron trigger tasks.
				</p>
			</div>

			{/* Status Alerts */}
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
				{/* Left Side: Create form */}
				{role !== 'viewer' && (
					<div className="bg-slate-900/30 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md space-y-5">
						<h3 className="text-lg font-bold text-white flex items-center gap-2">
							<Plus className="w-5 h-5 text-purple-400" />
							<span>New Schedule</span>
						</h3>

						<form onSubmit={handleCreateSchedule} className="space-y-4 text-xs">
							<div className="space-y-1">
								<label className="text-slate-400 font-medium">Schedule Name</label>
								<input
									type="text"
									placeholder="Daily API Endpoint Run"
									value={name}
									onChange={(e) => setName(e.target.value)}
									className="w-full bg-slate-950/80 border border-slate-850 text-slate-200 px-3 py-2 rounded-xl outline-none focus:border-purple-500/50 transition"
								/>
							</div>

							<div className="space-y-1">
								<label className="text-slate-400 font-medium">Cluster</label>
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
								<label className="text-slate-400 font-medium">Namespace</label>
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
								<label className="text-slate-400 font-medium">K6 Template</label>
								<select
									value={templateId}
									onChange={(e) => setTemplateId(e.target.value)}
									className="w-full bg-slate-950/80 border border-slate-850 text-slate-200 px-3 py-2 rounded-xl outline-none focus:border-purple-500/50 transition cursor-pointer"
								>
									{templates.map(t => (
										<option key={t.id} value={t.id}>{t.name}</option>
									))}
								</select>
							</div>

							<div className="flex items-center justify-between pt-2">
								<span className="text-slate-400 font-medium">Run on a Schedule</span>
								<input
									type="checkbox"
									checked={isScheduled}
									onChange={(e) => setIsScheduled(e.target.checked)}
									className="accent-purple-500 rounded border-slate-800 cursor-pointer"
								/>
							</div>

							{isScheduled && (
								<div className="space-y-1 animate-fadeIn">
									<label className="text-slate-400 font-medium">Cron Expression</label>
									<input
										type="text"
										placeholder="*/30 * * * *"
										value={cronExpr}
										onChange={(e) => setCronExpr(e.target.value)}
										className="w-full bg-slate-950/80 border border-slate-850 text-slate-200 px-3 py-2 rounded-xl outline-none focus:border-purple-500/50 transition font-mono"
									/>
									<p className="text-[10px] text-slate-500">
										Standard 5-field format: minute hour day-of-month month day-of-week
									</p>
								</div>
							)}

							{isScheduled && (
								<div className="flex items-center justify-between pt-2">
									<span className="text-slate-400 font-medium">Active Status</span>
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
								{loading ? 'Saving...' : (isScheduled ? 'Add Schedule (CronJob)' : 'Run Test (Job)')}
							</button>
						</form>
					</div>
				)}

				{/* Right Side: Schedules list */}
				<div className={`lg:col-span-2 bg-slate-900/30 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md space-y-4 ${role === 'viewer' ? 'lg:col-span-3' : ''}`}>
					<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
						<h3 className="text-lg font-bold text-white flex items-center gap-2">
							<Calendar className="w-5 h-5 text-purple-400" />
							<span>Scheduled Tasks</span>
						</h3>

						{/* Cluster & Namespace filters */}
						<div className="flex items-center gap-2 text-[11px]">
							<select
								value={filterCluster}
								onChange={(e) => setFilterCluster(e.target.value)}
								className="bg-slate-950/80 border border-slate-850 text-slate-300 hover:text-white px-2.5 py-1.5 rounded-xl outline-none focus:border-purple-500/50 transition cursor-pointer"
							>
								<option value="">All Clusters</option>
								{uniqueClusterIds.map(cId => (
									<option key={cId} value={cId}>{getClusterName(cId)}</option>
								))}
							</select>
							<select
								value={filterNamespace}
								onChange={(e) => setFilterNamespace(e.target.value)}
								className="bg-slate-950/80 border border-slate-850 text-slate-300 hover:text-white px-2.5 py-1.5 rounded-xl outline-none focus:border-purple-500/50 transition cursor-pointer"
							>
								<option value="">All Namespaces</option>
								{uniqueNamespaces.map(ns => (
									<option key={ns} value={ns}>{ns}</option>
								))}
							</select>
						</div>
					</div>

					{loading && schedules.length === 0 ? (
						<div className="py-12 text-slate-500 text-center text-xs">Loading schedules...</div>
					) : filteredSchedules.length === 0 ? (
						<div className="py-12 text-slate-500 text-center text-xs">
							{schedules.filter(s => !!s.cron_expression).length === 0 
								? 'No schedules configured.' 
								: 'No schedules match selected filters.'}
						</div>
					) : (
						<div className="space-y-4 overflow-y-auto max-h-[600px] pr-1">
							{filteredSchedules.map((sched) => (
								<div 
									key={sched.id} 
									className="p-4 bg-slate-950/20 border border-slate-850 rounded-2xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 hover:border-slate-800 transition duration-300"
								>
									<div className="space-y-2 min-w-0">
										<div className="flex items-center gap-2">
											<span className="font-semibold text-sm text-white truncate">{sched.name}</span>
											<span className={`px-2 py-0.5 rounded-md text-[9px] font-bold border ${
												sched.active 
													? 'bg-purple-500/10 text-purple-400 border-purple-500/20' 
													: 'bg-slate-800/55 text-slate-500 border-slate-800'
											}`}>
												{sched.active ? 'Active' : 'Inactive'}
											</span>
										</div>

										<div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-[10px] text-slate-400">
											<div className="flex items-center gap-1">
												<Server className="w-3.5 h-3.5 text-slate-500 shrink-0" />
												<span className="truncate">{getClusterName(sched.cluster_id)}</span>
											</div>
											<div className="flex items-center gap-1">
												<Layers className="w-3.5 h-3.5 text-slate-500 shrink-0" />
												<span className="truncate">{sched.namespace}</span>
											</div>
											<div className="flex items-center gap-1 col-span-2 sm:col-span-1">
												<Play className="w-3.5 h-3.5 text-slate-500 shrink-0" />
												<span className="truncate">{getTemplateName(sched.template_id)}</span>
											</div>
										</div>

										{sched.cron_expression ? (
											<div className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
												<Clock className="w-3.5 h-3.5 text-slate-600 shrink-0" />
												<span>Cron: {sched.cron_expression}</span>
											</div>
										) : (
											<div className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
												<Play className="w-3.5 h-3.5 text-slate-600 shrink-0" />
												<span>One-off execution (Job)</span>
											</div>
										)}
									</div>

									{role !== 'viewer' && (
										<div className="flex items-center space-x-2 shrink-0">
											<button
												onClick={() => sched.id && handleRunSchedule(sched.id)}
												disabled={sched.id !== undefined && runningIds.includes(sched.id)}
												className="p-2 border border-slate-850 hover:bg-emerald-500/10 text-slate-500 hover:text-emerald-400 rounded-xl transition cursor-pointer self-start sm:self-center disabled:opacity-50"
												title="Run Schedule Now"
											>
												<Play className="w-4 h-4" />
											</button>
											{sched.cron_expression && (
												<button
													onClick={() => sched.id && handleToggleSchedule(sched.id)}
													className={`p-2 border border-slate-850 rounded-xl transition cursor-pointer self-start sm:self-center ${
														sched.active 
															? 'hover:bg-purple-500/10 text-purple-400' 
															: 'hover:bg-slate-800 text-slate-500'
													}`}
													title={sched.active ? "Pause Schedule" : "Resume Schedule"}
												>
													{sched.active ? (
														<ToggleRight className="w-4 h-4" />
													) : (
														<ToggleLeft className="w-4 h-4 text-slate-500" />
													)}
												</button>
											)}
											<button
												onClick={() => sched.id && handleDeleteSchedule(sched.id, sched.name)}
												className="p-2 border border-slate-850 hover:bg-red-500/10 text-slate-500 hover:text-red-400 rounded-xl transition cursor-pointer self-start sm:self-center"
												title="Delete Schedule"
											>
												<Trash className="w-4 h-4" />
											</button>
										</div>
									)}
								</div>
							))}
						</div>
					)}
				</div>
			</div>

			{/* Custom Confirmation Dialog */}
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
								Cancel
							</button>
							<button
								onClick={confirmDialog.onConfirm}
								className="flex-1 py-2 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-xs font-semibold shadow-lg transition cursor-pointer hover:from-purple-500 hover:to-pink-400"
							>
								Confirm
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
