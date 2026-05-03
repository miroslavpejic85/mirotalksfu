'use strict';

function renderRoomTemplate(templateId, { text = {}, html = {}, attrs = {} } = {}) {
    const template = document.getElementById(templateId);
    if (!template || !template.content) return '';

    const wrapper = document.createElement('div');
    wrapper.appendChild(template.content.cloneNode(true));

    wrapper.querySelectorAll('*').forEach((element) => {
        element.getAttributeNames().forEach((name) => {
            if (!name.startsWith('data-template-attr-')) return;

            const attrName = name.replace('data-template-attr-', '');
            const key = element.getAttribute(name);
            const value = attrs[key];

            value === undefined || value === null
                ? element.removeAttribute(attrName)
                : element.setAttribute(attrName, value);

            element.removeAttribute(name);
        });
    });

    wrapper.querySelectorAll('[data-template-text]').forEach((element) => {
        const key = element.getAttribute('data-template-text');
        element.textContent = text[key] ?? '';
    });

    wrapper.querySelectorAll('[data-template-html]').forEach((element) => {
        const key = element.getAttribute('data-template-html');
        element.innerHTML = html[key] ?? '';
    });

    return wrapper.innerHTML.trim();
}
