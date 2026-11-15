import {
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

const UNSAFE_HTML_PATTERNS = [
  /<\s*\/?\s*[a-z][a-z0-9:-]*(?:\s+[^>]*)?>/i,
  /\bon[a-z]{2,}\s*=/i,
  /(?:javascript|vbscript)\s*:/i,
  /data\s*:\s*text\/html/i,
];

export function containsUnsafeHtml(value: string): boolean {
  return UNSAFE_HTML_PATTERNS.some((pattern) => pattern.test(value));
}

export function NoUnsafeHtml(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'noUnsafeHtml',
      target: object.constructor,
      propertyName,
      options: {
        message: `${propertyName} không được chứa mã HTML hoặc script không an toàn`,
        ...validationOptions,
      },
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return true;
          return !containsUnsafeHtml(value);
        },
      },
    });
  };
}
