## 1. UI Section Renaming (i18n)

- [x] 1.1 Update `crdControl` translation value from "K6 Operator CRDs" to "K6s TestRun CRDs" in the EN block of `frontend/src/components/PreferencesContext.tsx` (line 47)
- [x] 1.2 Update `crdControl` translation in FR block: "CRDs K6 Operator" → "CRDs K6s TestRun" (line 237)
- [x] 1.3 Update `crdControl` translation in HE block: "CRDs של K6 Operator" → "K6s TestRun CRDs" (line 427)
- [x] 1.4 Update `crdControl` translation in ZH block: "K6 算子 CRD" → "K6s TestRun CRDs" (line 617)
- [x] 1.5 Update `schedules` translation value from "Schedules" to "CronJob / Job" in the EN block (line 49)
- [x] 1.6 Update `schedules` translation in FR block: "Planifications" → "CronJob / Job" (line 239)
- [x] 1.7 Update `schedules` translation in HE block: "תזמונים" → "CronJob / Job" (line 429)
- [x] 1.8 Update `schedules` translation in ZH block: "计划任务" → "CronJob / Job" (line 619)
- [x] 1.9 Update the `recDesc` string in EN (line 159) that references "K6 Operator CRDs" to say "K6s TestRun CRDs"
- [x] 1.10 Update the `recDesc` string in ZH (line 729) that references "K6 Operator CRDs" to say "K6s TestRun CRDs"


## 2. Backend: Schedule Update Endpoint

- [ ] 2.1 Add `PUT /api/settings/schedules/{id}` route in `backend/internal/server/server.go` (near line 238, alongside existing schedule routes)
- [ ] 2.2 Implement `handleUpdateSchedule` handler: parse JSON body, set `sched.ID` from URL param, validate required fields, call `db.SaveSchedule()`, return updated schedule as JSON
- [ ] 2.3 Ensure the route is protected with editor/admin role middleware (same as `handleCreateSchedule`)

## 3. Frontend: API Client Update

- [ ] 3.1 Add `updateSchedule(id: number, data: Partial<TestSchedule>): Promise<TestSchedule>` method to `frontend/src/services/api.ts` using `PUT /api/settings/schedules/{id}`

## 4. Frontend: Edit CronJob Modal

- [ ] 4.1 Add `Pencil` (or `Edit`) icon import from `lucide-react` in `frontend/src/app/schedules/page.tsx`
- [ ] 4.2 Add edit-related state variables: `editingSchedule` (the schedule being edited or null), `editName`, `editClusterId`, `editNamespace`, `editTemplateId`, `editCronExpr`, `editActive`
- [ ] 4.3 Create `handleEditClick(schedule)` function that populates the edit state and opens the edit modal
- [ ] 4.4 Create `handleSaveEdit()` function that calls `api.updateSchedule()`, updates the schedules list on success, and shows success/error messages
- [ ] 4.5 Add Edit button (pencil icon) to each CronJob card action buttons area (lines 525-559), visible only for non-viewer roles, positioned before the Toggle button
- [ ] 4.6 Create the edit modal UI: same form layout as the create form but in a modal overlay (reuse the confirmation dialog styling pattern), with Save and Cancel buttons

## 5. Frontend: Round-Hour Cron Validation

- [ ] 5.1 Create `isRoundHourCron(expr: string): boolean` validation function — splits by whitespace, checks that the first field (minute) is exactly `0`
- [ ] 5.2 Add new i18n translation keys for the validation error message in all 4 languages (e.g., `cronRoundHourError`: "Schedules must start at a round hour (minute field must be 0)")
- [ ] 5.3 Apply the validation in `handleCreateSchedule` — if `isScheduled && !isRoundHourCron(cronExpr)`, set error and return
- [ ] 5.4 Apply the same validation in `handleSaveEdit` — if `editCronExpr` fails validation, set error and return
- [ ] 5.5 Add new i18n keys for edit-related UI strings in all 4 languages: `editSchedule`, `editScheduleTitle`, `saveChanges`, `scheduleUpdateSuccess`, `scheduleUpdateFailed`

## 6. Verification

- [ ] 6.1 Build the Go backend: `cd backend && go build ./...`
- [ ] 6.2 Build the Next.js frontend: `cd frontend && npx tsc --noEmit`
- [ ] 6.3 Verify sidebar labels display correctly in all 4 languages
- [ ] 6.4 Verify CronJob edit flow: open modal → modify fields → save → list updates
- [ ] 6.5 Verify round-hour cron validation blocks `30 11 * * *` but allows `0 11 * * *`
