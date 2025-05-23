import { ErAnalysis } from "https://cdn.jsdelivr.net/gh/orstavik/doubledots@main25.05.13.13/ddx.js";

const stringTemplate = (pattern, ...args) => args.reduce((p, v, i) => p.replaceAll(`\${${i}}`, v), pattern);
const er = i => new ErAnalysis(i);
const getId = url => (url.searchParams.get("post"));
const getKey = _ => (new URL(location.href).searchParams.get("key"));
const getPost = ({snaps, id}) => snaps?.[id] ? snaps[id] : EventLoop.Break;
const getPostWithRelation = ({snaps, id}) => snaps?.posts?.[id] ? snaps.posts[id] : EventLoop.Break;
const addPostKey = ({ snaps, post }) => {
    const { email, ...keys } = snaps.schema[post.type];
    return { post, keys };
};
const getPostRelation = ({post, key}) => post[key] ?? [];
const getPostTypeKey = ({snaps, key}) => (
    Object.keys(snaps)
        //check for key/key(s)
        .filter(k => [key, key.slice(0, -1)].includes(k.split("/")[0]))
);
const diff = ({ relation, postkeytype }) => {
    return postkeytype.filter(key => !relation.includes(key));
};
const saveReferences = function(key) {
    if (!window.opener)
        return EventLoop.Break;
    const droppable = document.querySelector(".droppable");
    const draggables = droppable.querySelectorAll(".draggable");
    let references = [];
    for (let draggable of draggables)
        references.push(draggable.textContent);
    window.opener.postMessage({ type: "references", data: { key, references } }, location.origin);
    window.close();
};
const showPost = ({post, keys}) => {
    const postDisplay = {
        ...post,
        created: new Date(post.created).toISOString().slice(0,10),
        updated: new Date(post.updated).toISOString().slice(0,10)
    };
    for (let key in keys)
    if (Array.isArray(post[key])) keys[key] = "relation"; 
    return { post: postDisplay, keys: {...keys, created: "date", updated: "date"} };
};
let prev;
function nextclass(v) {
    const el = this.ownerElement.nextElementSibling;
    prev && el.classList.remove(prev);
    el.setAttribute("class", el.getAttribute("class") + " " + (prev = v));
}
const getDisplayPosition = (e) => {
    const pad = 30;
    const left = e.clientX + pad + "px";
    const top = document.body.scrollTop + e.clientY + "px";
    return {left, top};
};
const showPostDetail = (postId, { left, top }) => {
    document.body.insertAdjacentHTML("beforeend", `<iframe style="position: absolute; left: ${left}; top: ${top};" width="300" height="300" src="/showPost?post=${postId}"></iframe>`);
};
const hidePostDetail = () => document.body.removeChild(document.body.lastChild);
const shrinkAll = (e) => {
    e.stopPropagation();
    const focused = document.querySelector("img.focused");
    focused && focused.classList.remove("focused");
};
function grow() { this.ownerElement.classList.add("focused") };    
function selected(key) {
    if (!window.opener) 
        return EventLoop.Break;
    const src = this.ownerElement.getAttribute("src");
    window.opener.postMessage({ type: "image", data: { key, imageURL: src } }, location.origin);
    window.close();
};
function formDiff(newPost) {
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
};
function parseRelation (diff) {
    if (Object.keys(diff).length === 0)
        return EventLoop.Break;
    const oldPost = JSON.parse(this.ownerElement.getAttribute("post"));
    for (let key in diff)
        if (typeof oldPost[key] === "object")
        diff[key] = JSON.parse(diff[key]);
    return diff;
};
async function editPost(data) {
    const oldPost = JSON.parse(this.ownerElement.getAttribute("post"));
    const response = await fetch("/api/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({...data, uid: oldPost.uid})
    });
    return response.ok ? "Edited": "Failed Editing...";
};
const alert_ = msg => alert(msg);
function selectInOtherTab(e) {
    e.preventDefault();
    const href = this.ownerElement.getAttribute("href");
    window.open(href, "_blank");
};
function formdataJson() {
    const formdata = new FormData(this.ownerElement);
    return Object.fromEntries(formdata.entries());
};

export {
 stringTemplate,
 er,
 getId,
 getKey,
 getPost,
 getPostWithRelation,
 addPostKey,
 getPostRelation,
 getPostTypeKey,
 diff,
 saveReferences,
 showPost,
 nextclass,
 getDisplayPosition,
 showPostDetail,
 hidePostDetail,
 shrinkAll,
 grow,    
 selected,
 formDiff,
 parseRelation,
 editPost,
 alert_,
 selectInOtherTab,
 formdataJson
};