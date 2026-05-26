async function loadLiveLogs() {
    try {
        const response = await fetch('http://localhost:8000/api/guardian/browsing-logs', {
            headers: { 'Authorization': `Bearer ${authData.token}` }
        });
        if (!response.ok) throw new Error('API Error');
        const logs = await response.json();
        
        const list = document.getElementById('liveLogsList');
        list.innerHTML = '';
        if(logs.length === 0) {
            list.innerHTML = '<tr><td colspan="4">No logs yet.</td></tr>';
            return;
        }

        logs.forEach(log => {
            const tr = document.createElement('tr');
            const timeStr = new Date(log.created_at).toLocaleTimeString();
            let statusBadge = log.status === 'blocked' ? '<span class="badge bg-danger">Blocked</span>' : '<span class="badge bg-success">Allowed</span>';
            tr.innerHTML = `
                <td>${log.user_name}</td>
                <td>${timeStr}</td>
                <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${log.url}">${log.url}<br><small class="text-muted">${log.title}</small></td>
                <td>${statusBadge}</td>
            `;
            list.appendChild(tr);
        });
    } catch(err) {
        console.error(err);
    }
}

async function loadGuardedDevices() {
    try {
        const response = await fetch('http://localhost:8000/api/devices', {
            headers: { 'Authorization': `Bearer ${authData.token}` }
        });
        if (!response.ok) throw new Error('API Error');
        const devices = await response.json();
        
        const list = document.getElementById('devicesList');
        list.innerHTML = '';
        if(devices.length === 0) {
            list.innerHTML = '<tr><td colspan="6">No devices.</td></tr>';
            return;
        }

        devices.forEach(dev => {
            const tr = document.createElement('tr');
            const statusStr = dev.revoked ? '<span class="badge bg-danger">Revoked</span>' : '<span class="badge bg-success">Active</span>';
            const revokeBtn = dev.revoked ? '' : `<button class="btn btn-sm btn-danger" onclick="promptRevoke('${dev.device_id}')">Revoke</button>`;
            tr.innerHTML = `
                <td>${dev.device_id.substring(0,8)}...</td>
                <td>User ID: ${dev.user_id}</td>
                <td>${dev.device_email || 'N/A'}</td>
                <td>${new Date(dev.last_seen).toLocaleString()}</td>
                <td>${statusStr}</td>
                <td>
                    <button class="btn btn-sm btn-info" onclick="viewAudit('${dev.device_id}')">Audit</button>
                    ${revokeBtn}
                </td>
            `;
            list.appendChild(tr);
        });
    } catch(err) {
        console.error(err);
    }
}

async function promptRevoke(deviceId) {
    const reason = prompt("Enter reason for revoking access:");
    if (reason === null) return;
    try {
        const response = await fetch('http://localhost:8000/api/device/revoke', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${authData.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ device_id: deviceId, reason: reason })
        });
        if (response.ok) {
            showAlert('Device revoked', 'success');
            loadGuardedDevices();
        } else {
            showAlert('Failed or unauthorized', 'danger');
        }
    } catch(err) { console.error(err); }
}

async function viewAudit(deviceId) {
    try {
        const response = await fetch(`http://localhost:8000/api/device/${deviceId}/audit`, {
            headers: { 'Authorization': `Bearer ${authData.token}` }
        });
        if (!response.ok) return alert("Failed to fetch audit.");
        const items = await response.json();
        let msg = `Audit Trail for ${deviceId.substring(0,8)}:\n\n`;
        items.forEach(i => {
            msg += `[${new Date(i.created_at).toLocaleString()}] ${i.action.toUpperCase()} - Reason: ${i.reason || 'None'}\n`;
        });
        alert(msg);
    } catch(e) { console.error(e); }
}

function initLiveWebsockets() {
    let wsUrl = `ws://localhost:8000/ws/guardian/${authData.userInfo.id}?token=${authData.token}`;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = function(event) {
        const data = JSON.parse(event.data);
        console.log("WebSocket event", data);
        if (data.type === 'browsing_log') {
            showAlert(`Live: ${data.status} access to ${data.url}`, data.status === 'blocked' ? 'danger' : 'info');
            loadLiveLogs(); // refresh listing
        }
    };
    ws.onclose = function(e) {
        console.log("WS closed, reconnecting...", e);
        setTimeout(initLiveWebsockets, 3000);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // wait for authData to be set by the main JS
    setTimeout(() => {
        if(typeof authData !== 'undefined' && authData && authData.token) {
            loadLiveLogs();
            loadGuardedDevices();
        }
    }, 1000);
});