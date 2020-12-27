import MediaChromeElement from './media-chrome-element.js';
import { createTemplateElement, defineCustomElement } from './utils/document.js';

const template = createTemplateElement();

template.innerHTML = `
  <style>
    :host {
      display: block;
      position: absolute;
      width: 300px;
      height: auto;
      right: 5px;
      bottom: 45px;
      padding: 10px;
      border: 1px solid #333;
      color: #ccc;
      background-color: #000;
    }
  </style>
  <slot></slot>

  <!-- This is too much for a menu... -->

  <media-chrome-panel>
  <media-chrome-menu>
    <media-chrome-submenu-menuitem label="Playback speed" value="1.2">
    </media-chrome-submenu-menuitem>
    <media-chrome-menuitem>Hello1</media-chrome-menuitem>
    <media-chrome-menuitem>Hello1</media-chrome-menuitem>
    <media-chrome-menuitem>Hello1</media-chrome-menuitem>
    <media-chrome-menuitem>Hello1</media-chrome-menuitem>
  </media-chrome-menu>
  <media-chrome-menu slot="menu">
    <media-chrome-menuitem>Normal</media-chrome-menuitem>
    <media-chrome-menuitem>1.5</media-chrome-menuitem>
  </media-chrome-menu>
`;

class MediaSettingsPopup extends MediaChromeElement {
  constructor() {
    super();

    const shadow = this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(template.content.cloneNode(true));
  }

  mediaSetCallback(media) {

  }

  mediaUnsetCallback() {

  }
}

defineCustomElement('media-settings-popup', MediaSettingsPopup);

export default MediaSettingsPopup;
