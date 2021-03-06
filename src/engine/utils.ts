/*!
 * tesen - Simple TypeScript 2D Canvas Game Engine
 * @author Anders Evenrud <andersevenrud@gmail.com>
 * @license MIT
 */

import EventEmitter from 'eventemitter3';

/**
 * Throttles a function
 */
export const throttle = (fn: Function, time: number = 100): any => {
  let timeout: number;
  return (): void => {
    clearTimeout(timeout);
    timeout = setTimeout(fn, time);
  };
};

/**
 * Check if integer number
 */
export const isInt = (i: number): boolean => i % 1 === 0;

/**
 * Check if float number
 */
export const isFloat = (i: number): boolean => !isInt(i);

/**
 * Check if negative number
 */
export const isNegative = (i: number): boolean => Object.is(-0, i) || i < 0;

/**
 * Capitalizes word
 */
export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Request browser to save a file
 */
export const requestSaveFile = (blob: Blob, filename: string) => {
  if (window.navigator && window.navigator.msSaveOrOpenBlob) {
    window.navigator.msSaveOrOpenBlob(blob, filename);
    return;
  }

  const file = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.setAttribute('style', 'display: none');
  a.setAttribute('href', file);
  a.setAttribute('download', filename);

  document.body.appendChild(a);
  a.click();

  window.URL.revokeObjectURL(file);
  document.body.removeChild(a);
};

/**
 * Request browser to open file
 */
export const requestLoadFile = (): Promise<string> => new Promise((resolve, reject) => {
  const input = document.createElement('input');
  input.type = 'file';

  input.addEventListener('change', (ev: Event) => {
    if (input.files!.length > 0) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (reader.error) {
          reject(reader.error);
        } else if (reader.readyState === 2) {
          resolve(reader.result as string);
        }
      };
      reader.onerror = evt => {
        reject(evt);
      };

      reader.readAsText(input.files![0]);
    }
  });

  input.addEventListener('error', (ev) => {
    reject(ev);
  });

  input.click();
});

/**
 * Fetch arraybuffer via XHR API
 */
export const fetchArrayBufferXHR = (url: string, bus?: EventEmitter): Promise<ArrayBuffer> =>
  new Promise((resolve, reject): void => {
    const xhr = new XMLHttpRequest();
    xhr.onload = (): void => resolve(xhr.response);
    xhr.onerror = reject;
    xhr.onabort = reject;

    if (bus) {
      xhr.onprogress = (ev: any): void => {
        bus.emit('progress', ev.loaded, ev.total);
      };
    }

    xhr.responseType = 'arraybuffer';
    xhr.open('GET', url, true);
    xhr.send();
  });

/**
 * Fetch arraybuffer via Fetch API
 */
export const fetchArrayBuffer = (url: string): Promise<ArrayBuffer> => fetch(url)
  .then((response: Response): Promise<ArrayBuffer> => response.arrayBuffer());

/**
 * Fetches an image via HTTP
 */
export const fetchImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject): void => {
    const image = new Image();
    image.onload = (): void => resolve(image);
    image.onerror = (error: any): void => reject(error);
    image.src = url;
  });

