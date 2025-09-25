import { Position, Range } from "../interfaces";

export function rangesEqual(r1: Range, r2: Range): boolean {
	return positionsEqual(r1.start, r2.start) && positionsEqual(r1.end, r2.end);
}

export function positionsEqual(p1: Position, p2: Position): boolean {
	return p1.line === p2.line && p1.character === p2.character;
}
