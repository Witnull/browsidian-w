import { promptDialog, promptHelp, promptInput, promptLabel, promptTitle } from "../ui/dom.js";

export function showPrompt({ title, label, help, placeholder, value }) {
    promptTitle.textContent = title;
    promptLabel.textContent = label;
    promptHelp.textContent = help || "";
    promptInput.value = value || "";
    promptInput.placeholder = placeholder || "";
    promptDialog.showModal();
    promptInput.focus();
    const len = promptInput.value.length;
    if (promptInput.value.endsWith("/")) {
        promptInput.setSelectionRange(len, len);
    } else {
        promptInput.select();
    }
    return new Promise((resolve) => {
        const onKeyDown = (e) => {
            if (e.isComposing) return;
            if (e.key !== "Enter") return;
            if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
            e.preventDefault();
            promptDialog.close("ok");
        };
        promptInput.addEventListener("keydown", onKeyDown);
        promptDialog.addEventListener(
            "close",
            () => {
                promptInput.removeEventListener("keydown", onKeyDown);
                const ok = promptDialog.returnValue === "ok";
                resolve(ok ? promptInput.value : null);
            },
            { once: true }
        );
    });
}
