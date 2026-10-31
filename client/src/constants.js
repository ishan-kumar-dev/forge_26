// Keep in sync with server/services/triage.js and the STATUSES list in server/index.js.
export const categories = ['Road damage','Water supply','Drainage','Sanitation','Streetlight','Public safety','Parks','Other'];
export const statuses = ['Submitted','Under Review','Verified','Assigned','In Progress','Resolved','Closed'];
export const departments = ['Roads & Public Works','Water Supply','Drainage','Sanitation','Electrical Maintenance','Emergency Response','Parks & Urban Forestry','Municipal Operations'];
export const formatDate = d => d ? new Date(d).toLocaleString() : '—';
