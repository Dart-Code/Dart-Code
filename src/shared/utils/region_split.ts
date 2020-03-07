import { sortBy } from "./array";

export class MappedRegion {

	constructor(
		readonly offset: number,
		readonly length: number,
		readonly tokenType: number,
		readonly tokenModifier: number = 0,
	) { }

	get endOffset(): number {
		return this.offset + this.length;
	}

	public copyWithRange(start: number, endExclusive: number) {
		return new MappedRegion(start, endExclusive - start, this.tokenType, this.tokenModifier);
	}
}

/**
 * Transform regions so that there are no two regions that overlap each other. For this purpose,
 * regions with a higher start offset take priority over regions with a lower start offset.
 *
 * For instance, let's say we had a string literal token `'hello\nworld'` with a start offset
 * of 0 and a length of 16. We also have a valid string escape token from offset 7 and a length
 * of 2. To remove overlapping regions, we would transform this into three tokens: A string literal
 * `'hello` from 0..6 (inclusive). Next, we'd emit the string escape token unchanged (7..8) followed
 * by the string literal `world'` from 9..16.
 *
 * The output will also be sorted by start offsets.
 *
 * @param regions array of regions where the overlappings should be removed
 */
export function removeOverlappings(regions: MappedRegion[]): MappedRegion[] {
	if (regions.length === 0) return [];

	sortBy(regions, (r) => r.offset);
	const output = Array<MappedRegion>();

	// current region we might have to split when an overlapping occurs.
	let currentStart = regions[0].offset;
	let currentEnd = currentStart + regions[0].length;
	let currentTargets = [regions[0]];

	regions.splice(0, 1);
	regions.forEach((region) => {
		const start = region.offset;
		const end = region.endOffset;

		if (start < currentEnd) {
			// we know start >= currentStart, since they're sorted. This is an overlap!
			let target = currentTargets[0];
			// find the first region in currentTarget that overlaps with the current
			while (target.endOffset <= region.offset) {
				// target is unaffected. Sorting guarantees there won't be any other regions
				// overlapping with it.
				output.push(target);
				currentTargets.splice(0, 1);
				currentStart = target.endOffset;

				target = currentTargets[0];
			}

			// replace target with splitted subregions
			currentTargets.splice(0, 1, ...splitSingle(target, region));
		} else {
			// region appears after what we're currently interested in. Since the list is
			// sorted by start offset, this means that there can't be more overlappings in
			// currentStart..currentEnd.
			output.push(...currentTargets);
			currentTargets = [region];
			currentStart = start;
			currentEnd = end;
		}
	});

	// add remaining
	output.push(...currentTargets);

	return output;
}

function splitSingle(target: MappedRegion, overlap: MappedRegion): MappedRegion[] {
	const output = Array<MappedRegion>();
	if (target.offset !== overlap.offset) {
		// some region of target comes before the overlap starts
		output.push(target.copyWithRange(target.offset, overlap.offset));
	}
	output.push(overlap);
	if (target.endOffset > overlap.endOffset) {
		// more of target after overlap ended
		output.push(target.copyWithRange(overlap.endOffset, target.endOffset));
	}
	return output;
}
