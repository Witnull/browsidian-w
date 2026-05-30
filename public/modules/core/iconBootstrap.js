const spriteUrl = new URL("../ui/icons.html", import.meta.url);

try {
    const response = await fetch(spriteUrl);
    if (!response.ok) {
        throw new Error(`Failed to load icon sprite: ${response.status} ${response.statusText}`);
    }

    const spriteMarkup = await response.text();
    document.body.insertAdjacentHTML("afterbegin", spriteMarkup);
} catch (error) {
    console.error(error);
}

await import("../../app.js");
