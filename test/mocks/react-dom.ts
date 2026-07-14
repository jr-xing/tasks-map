// Mock React DOM
export const render = jest.fn();
export const createPortal = jest.fn((children) => children);
export const createRoot = jest.fn(() => ({
  render: jest.fn(),
  unmount: jest.fn(),
}));

export default {
  render,
  createPortal,
  createRoot,
};
