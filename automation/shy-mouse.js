import ShyMouse from './shy-mouse-movement.js';

export default ShyMouse;
export { ShyMouse };

export function getShyMouse(page, options = {}) {
  if (!page.__shyMouse) page.__shyMouse = new ShyMouse(page, options);
  return page.__shyMouse;
}
