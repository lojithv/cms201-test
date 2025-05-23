import { ErAnalysis } from "https://cdn.jsdelivr.net/gh/orstavik/doubledots@main25.05.13.13/ddx.js?fetch_json&oi.~&embrace&Csss&Class&NAV&STATE~~";

const stringTemplate = (pattern, ...args) => args.reduce((p, v, i) => p.replaceAll(`\${${i}}`, v), pattern);
document.Reactions.define("string-template", stringTemplate);
document.Reactions.define("er", i => new ErAnalysis(i));
document.Reactions.define("get-id", url => (url.searchParams.get("post")));
document.Reactions.define("get-key", _ => (new URL(location.href).searchParams.get("key")));
document.Reactions.define("get-post", ({snaps, id}) => snaps?.[id] ? snaps[id] : document.Reactions.break);
document.Reactions.define("get-post-with-relation", ({snaps, id}) => snaps?.posts?.[id] ? snaps.posts[id] : document.Reactions.break);
document.Reactions.define("add-post-key", ({ snaps, post }) => {
    const { email, ...keys } = snaps.schema[post.type];
    return { post, keys };
});
document.Reactions.define("get-post-relation", ({post, key}) => post[key] ?? []);
document.Reactions.define("get-post-type-key", ({snaps, key}) => (
    Object.keys(snaps)
        //check for key/key(s)
        .filter(k => [key, key.slice(0, -1)].includes(k.split("/")[0]))
));
document.Reactions.define("diff", ({ relation, postkeytype }) => {
    return postkeytype.filter(key => !relation.includes(key));
});
document.Reactions.define("save-references", function(key) {
    if (!window.opener)
        return document.Reactions.break;
    const droppable = document.querySelector(".droppable");
    const draggables = droppable.querySelectorAll(".draggable");
    let references = [];
    for (let draggable of draggables)
        references.push(draggable.textContent);
    window.opener.postMessage({ type: "references", data: { key, references } }, location.origin);
    window.close();
});
document.Reactions.define("show-post", ({post, keys}) => {
    const postDisplay = {
        ...post,
        created: new Date(post.created).toISOString().slice(0,10),
        updated: new Date(post.updated).toISOString().slice(0,10)
    };
    for (let key in keys)
    if (Array.isArray(post[key])) keys[key] = "relation"; 
    return { post: postDisplay, keys: {...keys, created: "date", updated: "date"} };
});
let prev;
function nextSiblingClass(v) {
    const el = this.ownerElement.nextElementSibling;
    prev && el.classList.remove(prev);
    el.setAttribute("class", el.getAttribute("class") + " " + (prev = v));
}
document.Reactions.define("nextclass", nextSiblingClass);
document.Reactions.define("get-display-position", function(e) {
    const pad = 30;
    const left = e.clientX + pad + "px";
    const top = document.body.scrollTop + e.clientY + "px";
    return {left, top};
});
document.Reactions.define("show-post-detail", function(postId, { left, top }) {
    document.body.insertAdjacentHTML("beforeend", `<iframe style="position: absolute; left: ${left}; top: ${top};" width="300" height="300" src="/showPost?post=${postId}"></iframe>`);
});
document.Reactions.define("hide-post-detail", () => document.body.removeChild(document.body.lastChild));
document.Reactions.define("shrink-all", function(e) {
    e.stopPropagation();
    const focused = document.querySelector("img.focused");
    focused && focused.classList.remove("focused");
});
document.Reactions.define("grow", function() { this.ownerElement.classList.add("focused") });    
document.Reactions.define("selected", function(key) {
    if (!window.opener) 
        return document.Reactions.break;
    const src = this.ownerElement.getAttribute("src");
    window.opener.postMessage({ type: "image", data: { key, imageURL: src } }, location.origin);
    window.close();
});
document.Reactions.define("form-diff", function(newPost) {
    const diff = {};
    const oldPost = JSON.parse(this.ownerElement.getAttribute("post")); 
    for (let [k,v1] of Object.entries(newPost)) {
        const old = oldPost[k]; 
        const v2  = typeof old === "object" ? JSON.stringify(old) : old;
        if (!v1 && !oldPost.hasOwnProperty(k))
            continue;
        if (v1 !== v2)
            diff[k] = v1;
    }
    return diff;
});
document.Reactions.define("parse-relation", function (diff) {
    if (Object.keys(diff).length === 0)
        return document.Reactions.break;
    const oldPost = JSON.parse(this.ownerElement.getAttribute("post"));
    for (let key in diff)
        if (typeof oldPost[key] === "object")
        diff[key] = JSON.parse(diff[key]);
    return diff;
});
document.Reactions.define("edit-post", async function(data) {
    if (!data) 
        return "Nothing is Updated!";
    const oldPost = JSON.parse(this.ownerElement.getAttribute("post"));
    const response = await fetch("/api/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({...data, uid: oldPost.uid})
    });
    return response.ok ? "Edited": "Failed Editing...";
});
document.Reactions.define("alert", (msg) => alert(msg));
document.Reactions.define("select-in-other-tab", function(e) {
    e.preventDefault();
    const href = this.ownerElement.getAttribute("href");
    window.open(href, "_blank");
});
document.Reactions.define("formdata-json", function() {
    const formdata = new FormData(this.ownerElement);
    return Object.fromEntries(formdata.entries());
});