export const auditFixtures: [string, string][] = [
	["mixed.txt", `
shared_focus = { id = own x = 0 y = 0 }
shared_focus = { x = 0 y = 0 }
joint_focus = { id = anchor x = 2 y = 1 }
joint_focus = { x = 2 y = 1 }
focus_tree = { id = importing shared_focus = own shared_focus = external shared_focus = missing
 focus = { id = local x = 0 y = 0 }
 focus = { id = local x = 1 y = 0 }
 focus = { id = "" x = 1 y = 0 }
}
focus_tree = { id = local_only focus = { id = a x = 0 y = 0 } focus = { id = b x = 0 y = 0 } }
`],
	["missing-id.txt", `focus_tree = { id = missing_id shared_focus = external
 focus = { x = 0 y = 0 } focus = { id = x x = 0 y = 0 }
}`],
	["external.txt", `shared_focus = { id = external x = 0 y = 0 }
shared_focus = { id = child prerequisite = { focus = external } relative_position_id = external x = 0 y = 0 }
shared_focus = { x = 0 y = 0 }
`],
	["duplicate-donor.txt", "shared_focus = { id = external x = 20 y = 20 }"],
	["other.txt", `focus_tree = { id = other shared_focus = external
 focus = { id = first x = 0 y = 0 relative_position_id = second }
 focus = { id = second x = 0 y = 0 relative_position_id = first }
 focus = { id = gated x = 0 y = 0 allow_branch = { has_country_flag = path_a } }
 focus = { id = othergate x = 0 y = 0 allow_branch = { NOT = { has_country_flag = path_a } } }
}`],
];
