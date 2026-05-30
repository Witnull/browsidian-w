import {
    authDialog,
    authForm,
    authTitle,
    authHelp,
    authAccount,
    authPassword,
    authRegisterToggle,
    authCancel,
    authSubmit
} from "../ui/dom.js";
import { setStatus } from "../ui/uiState.js";
import { apiSend } from "./api.js";
// Show auth dialog for login/register. Returns { action: 'submit'|'cancel', register: boolean, account, password }
function showAuthDialog({ title = 'Login', help = ''} = {}) {
    return new Promise((resolve) => {
        if (!authDialog) return resolve(null);
        authTitle.textContent = title;
        authHelp.textContent = help || '';
        authAccount.value = '';
        authPassword.value = '';

        function cleanup() {
            authForm.removeEventListener('submit', onSubmit);
            authDialog.removeEventListener('close', onClose);
        }

        function onSubmit(e) {
            e.preventDefault();
            const account = authAccount.value?.toString?.() || '';
            const password = authPassword.value?.toString?.() || '';
            cleanup();
            try { authDialog.close(); } catch { };
            resolve({ action: 'submit', account, password }); // use preset register mode
        }

        function onClose() {
            cleanup();
            resolve({ action: 'cancel' });
        }

        authForm.addEventListener('submit', onSubmit);
        authDialog.addEventListener('close', onClose, { once: true });
        try { authDialog.showModal(); } catch { authDialog.open = true; }
        authAccount.focus();
    });
}


export async function performAuth(hostname, registered){
    if (!registered){
        setStatus("Vault is not registered. Registration required (local only).", "r");
        // If running in browser on the server host, offer in-app registration modal
        const hostIsLocal = (hostname === 'localhost' || hostname === '127.0.0.1');
        if (hostIsLocal) {
            // show auth dialog in register mode
            const result = await showAuthDialog({ title: 'Register vault account', help: 'Registration is allowed only from the server host (local). Registering creates a single account for this vault.'});
            if (result && result.action === 'submit') {
                try {
                    const r = await apiSend("POST", "/api/register", { account: result.account, password: result.password });
                    if (r && r.ok) {
                        setStatus("Registration successful. Reloading…", "y");
                        return [true, true];
                    }
                } catch (e) {
                    setStatus(`Registration failed: ${e.message}`, "r");
                    return [false, true];
                }
            }
        } else{
            console.warn("Host is not local cannot register: "+ hostname.toString())
            return [false, false]
        }}else{
             // Attempt locally login 
            try {
                const rx = await apiSend("GET", "/api/islocallogged")
                if (rx && rx.ok){
                    setStatus("Ready.","g")
                    return [true, true];
                }
            } catch (e) {}
            /// manual remote login
            setStatus("Please login...","y");
            const result = await showAuthDialog({ title: 'Login vault account', help: 'Please use account to login.'});
            if (result && result.action === 'submit') {
                try {
                    const r = await apiSend("POST", "/api/login", { account: result.account, password: result.password });
                    if (r && r.ok) {
                        setStatus("Login successful. Reloading…", "y");
                        return [true, true];
                    }
                } catch (e) {
                    setStatus(`Login failed: ${e.message}`, "r");
                    return [false, true];
                }
            }
    }
    
    return [false, false];
}