import type { Revision } from "@/tauri-commands";
import { NODE_RADIUS } from "./constants";

interface GraphNodeProps {
	revision: Revision;
	lane: number;
	isSelected: boolean;
	color: string;
}

/**
 * GraphNode - Semantic node component rendered inline with each row
 * Uses inline SVG for proper accessibility (avoids role="img" on divs)
 *
 * Three variants:
 * - Working copy: @ symbol with glow
 * - Immutable: diamond shape
 * - Regular mutable: circle
 */
export function GraphNode({ revision, lane, isSelected, color }: GraphNodeProps) {
	const isWorkingCopy = revision.is_working_copy;
	const isImmutable = revision.is_immutable;

	const size = isWorkingCopy ? NODE_RADIUS * 2 + 6 : NODE_RADIUS * 2;
	const selectedRingSize = isWorkingCopy ? NODE_RADIUS + 6 : NODE_RADIUS + 4;

	// Working copy: @ symbol with glow
	if (isWorkingCopy) {
		return (
			<svg
				width={size + 8}
				height={size + 8}
				viewBox={`0 0 ${size + 8} ${size + 8}`}
				className="shrink-0"
				aria-label={`Working copy revision ${revision.change_id_short}`}
				data-revision-id={revision.change_id}
				data-lane={lane}
			>
				<title>Working copy: {revision.change_id_short}</title>
				{isSelected && (
					<circle
						cx={(size + 8) / 2}
						cy={(size + 8) / 2}
						r={selectedRingSize}
						fill={color}
						fillOpacity={0.3}
					/>
				)}
				<circle
					cx={(size + 8) / 2}
					cy={(size + 8) / 2}
					r={NODE_RADIUS + 3}
					fill={color}
					fillOpacity={0.2}
				/>
				<text
					x={(size + 8) / 2}
					y={(size + 8) / 2}
					textAnchor="middle"
					dominantBaseline="central"
					fill={color}
					fontWeight="bold"
					fontSize="12"
				>
					@
				</text>
			</svg>
		);
	}

	// Immutable: diamond shape
	if (isImmutable) {
		return (
			<svg
				width={size + 8}
				height={size + 8}
				viewBox={`0 0 ${size + 8} ${size + 8}`}
				className="shrink-0"
				aria-label={`Immutable revision ${revision.change_id_short}`}
				data-revision-id={revision.change_id}
				data-lane={lane}
			>
				<title>Immutable: {revision.change_id_short}</title>
				{isSelected && (
					<circle
						cx={(size + 8) / 2}
						cy={(size + 8) / 2}
						r={selectedRingSize}
						fill={color}
						fillOpacity={0.3}
					/>
				)}
				<rect
					x={(size + 8) / 2 - NODE_RADIUS}
					y={(size + 8) / 2 - NODE_RADIUS}
					width={NODE_RADIUS * 2}
					height={NODE_RADIUS * 2}
					fill={color}
					transform={`rotate(45 ${(size + 8) / 2} ${(size + 8) / 2})`}
				/>
			</svg>
		);
	}

	// Regular mutable: circle
	return (
		<svg
			width={size + 8}
			height={size + 8}
			viewBox={`0 0 ${size + 8} ${size + 8}`}
			className="shrink-0"
			aria-label={`Revision ${revision.change_id_short}`}
			data-revision-id={revision.change_id}
			data-lane={lane}
		>
			<title>Revision: {revision.change_id_short}</title>
			{isSelected && (
				<circle
					cx={(size + 8) / 2}
					cy={(size + 8) / 2}
					r={selectedRingSize}
					fill={color}
					fillOpacity={0.3}
				/>
			)}
			<circle cx={(size + 8) / 2} cy={(size + 8) / 2} r={NODE_RADIUS} fill={color} />
		</svg>
	);
}
