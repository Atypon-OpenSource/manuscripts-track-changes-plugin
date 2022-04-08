/*!
 * © 2022 Atypon Systems LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export function polyfillDom() {
  document.createRange = () => {
    const range = new Range()

    range.getBoundingClientRect = function () {
      return {
        toJSON() {
          return {}
        },
        width: 0,
        height: 0,
        top: 0,
        left: 0,
        x: 0,
        y: 0,
        right: 0,
        bottom: 0,
      }
    }

    range.getClientRects = () => {
      return {
        item: () => null,
        length: 0,
        [Symbol.iterator]: jest.fn(),
      }
    }

    return range
  }
}
