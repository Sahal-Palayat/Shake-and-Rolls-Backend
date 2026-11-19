import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { Types } from 'mongoose';

function assertObjectId(value: unknown): string {
  // isValid() also accepts any 12-char string; the round-trip check rejects those.
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value) || new Types.ObjectId(value).toHexString() !== value) {
    throw new BadRequestException('Invalid id');
  }
  return value;
}

/** Rejects malformed ids with 400 instead of letting Mongoose throw a CastError (500). */
@Injectable()
export class ParseObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    return assertObjectId(value);
  }
}

/** Same, but an absent value passes through (optional query params). */
@Injectable()
export class OptionalParseObjectIdPipe implements PipeTransform<string | undefined, string | undefined> {
  transform(value: string | undefined): string | undefined {
    return value === undefined ? undefined : assertObjectId(value);
  }
}
