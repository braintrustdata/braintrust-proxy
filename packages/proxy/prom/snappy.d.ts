declare module "snappyjs" {
  export function compress<T>(data: T): T;
  export function uncompress<T>(data: T): T;
}
