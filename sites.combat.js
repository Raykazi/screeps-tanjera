let Roles = require("roles");
let Hive = require("hive");

let _CPU = require("util.cpu");

module.exports = {
	Run: function(combat_id) {
		if (_.get(Memory, ["sites", "combat", combat_id, "tactic"]) == null)
			return;

		let rmColony = _.get(Memory, ["sites", "combat", combat_id, "colony"]);
		
		if (Hive.isPulse_Spawn()) {
			_CPU.Start(rmColony, `Combat-${combat_id}-runPopulation`);
			this.setPopulation(combat_id);
			this.runPopulation(combat_id);
			_CPU.End(rmColony, `Combat-${combat_id}-runPopulation`);
		}
		
		_CPU.Start(rmColony, `Combat-${combat_id}-runTactic`);
		this.runTactic(combat_id);
		_CPU.End(rmColony, `Combat-${combat_id}-runTactic`);
	},
	
	setPopulation: function(combat_id) {
		let _Colony = require("util.colony");

		let combat = _.get(Memory, ["sites", "combat", combat_id]);
		let tacticType = _.get(combat, ["tactic", "type"]);
		let rmColony = _.get(combat, ["colony"]);
		let rmLevel = _Colony.getRoom_Level(rmColony);
		let army = _.get(combat, ["tactic", "army"]);


		if (_.get(combat, ["tactic", "spawn_repeat"]) == null)
			_.set(Memory, ["sites", "combat", combat_id, "tactic", "spawn_repeat"], true);

		if (army != null)
			return;

		switch(tacticType) {
			default:
			case "waves":			army = _.clone(Population_Combat__Waves);			break;
			case "trickle":			army = _.clone(Population_Combat__Trickle);			break;
			case "occupy":			army = _.clone(Population_Combat__Occupy);			break;
			case "tower_drain":		army = _.clone(Population_Combat__Tower_Drain);		break;
		}

		for (let each in army) {
			if (_.get(army[each], "level") == null)
				_.set(army[each], "level", rmLevel);
		}

		_.set(Memory, ["sites", "combat", combat_id, "tactic", "army"], _.clone(army));
	},
	
	runPopulation: function(combat_id) {
		let combat = _.get(Memory, ["sites", "combat", combat_id]);
		let state_combat = _.get(combat, "state_combat");
		let rmColony = _.get(combat, ["colony"]);

		if (state_combat == "spawning") {
			let _Colony = require("util.colony");
			let listArmy = _.get(combat, ["tactic", "army"]);
			let lengthArmy = _.sum(listArmy, s => { return s.amount; });
			let rmColony = _.get(combat, ["colony"]);
			let rmLevel = _Colony.getRoom_Level(rmColony);
			let listSpawnRooms = _.get(combat, ["list_spawns"]);

			let listCreeps = _.filter(Game.creeps, c => { return _.get(c, ["memory", "combat_id"]) == combat_id; });

			for (let role in listArmy) {
				let listRole = _.filter(listCreeps, c => { return _.get(c, ["memory", "role"]) == role; });
				if (listRole.length < _.get(listArmy, [role, "amount"])) {
					Memory["hive"]["spawn_requests"].push({ 
						room: rmColony, 
						listRooms: listSpawnRooms, 
						priority: 0, 
						level: (_.get(listArmy, [role, "level"]) == null ? rmLevel : listArmy[role]["level"]),
						scale_level: false,
						body: (listArmy[role]["body"] == null ? role : listArmy[role]["body"]), 
						name: null, 
						args: { role: role, combat_id: combat_id, 
								room: _.get(combat, "target_room") , colony: rmColony,
								listRoute: _.get(combat, "list_route") } });
				}
			}
		}
	},
	
	runTactic: function(combat_id) {
		let combat = _.get(Memory, ["sites", "combat", combat_id]);
		let state_combat = _.get(combat, "state_combat");

		if (state_combat == null)
			_.set(Memory, ["sites", "combat", combat_id, "state_combat"], "spawning");

		switch (_.get(combat, ["tactic", "type"])) {
			case "waves": 			this.runTactic_Waves(combat_id, combat);				break;
			case "trickle":			this.runTactic_Trickle(combat_id, combat);				break;
			// Occupy tactic same as Trickle tactic using different army population.
			case "occupy":		this.runTactic_Trickle(combat_id, combat);				break;
			case "tower_drain":		this.runTactic_Tower_Drain(combat_id, combat);			break;
		}
	},

	runTactic_Waves: function(combat_id, combat) {
		let tactic = _.get(combat, "tactic");
		let state_combat = _.get(combat, "state_combat");
		let listCreeps = _.filter(Game.creeps, c => { return _.get(c, ["memory", "combat_id"]) == combat_id; });
		let army = _.get(combat, ["tactic", "army"]);
		let army_amount = _.sum(army, s => { return s.amount; });
		
		switch (state_combat) {	
			case "spawning":
			case "rallying":
				let rally_range = 5;
				let rally_pos = _.get(tactic, "rally_pos");

                _.each(listCreeps, creep => {
					if (_.get(combat, "use_boosts") && this.creepBoost(creep))
						return;
					this.creepRally(creep, rally_pos);	
				});
				
				if (checkSpawnComplete_toRally(combat_id, combat, listCreeps, army_amount))
					return;
				if (checkRallyComplete_toAttack(combat_id, combat, listCreeps, rally_pos, rally_range, army_amount))
					return;
				return;
			
			case "attacking":
				// Run the creeps' base roles!
				creepRoles(listCreeps, tactic);

				// Evaluate victory or reset conditions
				if (Game.time % 10 == 0) {
					if (evaluateDefeat_CreepsWiped(combat_id, combat, listCreeps))
						return;
					else if (listCreeps.length == 0 && _.get(combat, "spawn_repeat")) {
						_.set(Memory, ["sites", "combat", combat_id, "state_combat"], "spawning");
						return;
					}

					let target_room = _.get(combat, "target_room");
					let room_structures = Game["rooms"][target_room].find(FIND_STRUCTURES);
					if (evaluateVictory_TargetStructures(combat_id, combat, room_structures))
						return;
					if (evaluateVictory_TargetList(combat_id, combat, room_structures))
						return;
				}
				return;
				
			case "complete":
				if (_.get(combat, ["tactic", "to_occupy"]))
					setOccupation(combat_id, combat, tactic);
				delete Memory["sites"][combat_id];	
				console.log(`<font color=\"#FFA100\">[Combat: ${combat_id}]</font> ` 
					+ `Combat completed, removing from memory.`);			
				return;
		}
	},

	runTactic_Trickle: function(combat_id, combat) {
		let tactic = _.get(combat, "tactic");
		let state_combat = _.get(combat, "state_combat");
		let listCreeps = _.filter(Game.creeps, c => { return _.get(c, ["memory", "combat_id"]) == combat_id; });
		
		switch (state_combat) {	
			// Trickle tactic is a constant state of spawning and moving to trickle into destination room
			case "spawning":
                _.each(listCreeps, creep => {
					if (_.get(combat, "use_boosts") && this.creepBoost(creep))
						return;
				});
				
				// Run the creeps' base roles!
				creepRoles(listCreeps, tactic);

				// Evaluate victory
				if (Game.time % 10 == 0) {
					let target_room = _.get(combat, "target_room");
					let room_structures = Game["rooms"][target_room].find(FIND_STRUCTURES);
					if (evaluateVictory_TargetStructures(combat_id, combat, room_structures))
						return;
					if (evaluateVictory_TargetList(combat_id, combat, room_structures))
						return;
				}
				return;
				
			case "complete":
				if (_.get(combat, ["tactic", "to_occupy"]))
					setOccupation(combat_id, combat, tactic);
				delete Memory["sites"][combat_id];	
				console.log(`<font color=\"#FFA100\">[Combat: ${combat_id}]</font> ` 
					+ `Combat completed, removing from memory.`);
				return;
		}
	},
	
	runTactic_Tower_Drain: function(combat_id, combat) {
		
	},
		
	checkSpawnComplete_toRally: function(combat_id, combat, listCreeps, army_amount) {
		if (_.get(combat, "state_combat") == "spawning" && listCreeps.length == army_amount) {
			_.set(Memory, ["sites", "combat", combat_id, "state_combat"], "rallying");
			return true;
		}
		return false;
	},

	checkRallyComplete_toAttack: function(combat_id, combat, listCreeps, rally_pos, rally_range, army_amount) {
		let state_combat = _.get(combat, "state_combat");
		let posRally = new RoomPosition(rally_pos.x, rally_pos.y, rally_pos.roomName);
		let creeps_rallied = _.filter(listCreeps, c => c.room.name == rally_pos.roomName && posRally.inRangeTo(c.pos, rally_range));
		if (state_combat == "rallying" && listCreeps.length > 0 && Game.time % 5 == 0) {
			if (creeps_rallied.length == listCreeps.length) {
				_.set(Memory, ["sites", "combat", combat_id, "state_combat"], "attacking");
				console.log(`<font color=\"#FFA100\">[Combat: ${combat_id}]</font> `
					+ `All creeps at rally point. Launching attack!`);
				return true;
			}
		} else if (Game.time % 50 == 0) {	
			console.log(`<font color=\"#FFA100\">[Combat: ${combat_id}]</font> Spawning and rallying troops, `
			+ `${creeps_rallied.length} of ${army_amount} at rally point.`);
		}
		return false;
	},
	
	creepBoost: function(creep) {
		let _Combat = require("roles.combat");
		if (creep.room.name == rmColony) {						
			if (creep.memory.boost == null && !creep.isBoosted()) {
				if (_Combat.seekBoost(creep))
					return true;
			} else if (creep.memory.boost != null && !creep.isBoosted()) {
				creep.moveTo(creep.memory.boost.pos.x, creep.memory.boost.pos.y);
				return true;
			}
		}
		return false;
	},

	creepRally: function(creep, rally_pos, rallyRange) {
		let _Creep = require("util.creep");
		let posRally = new RoomPosition(rally_pos.x, rally_pos.y, rally_pos.roomName);

		if (creep.room.name != posRally.roomName)
			_Creep.moveToRoom(creep, posRally.roomName, true);
		else if (creep.room.name == posRally.roomName) {
			if (!posRally.inRangeTo(creep.pos, rallyRange))
				creep.moveTo(posRally);
			else {
				let hostile = _.head(creep.pos.findInRange(FIND_HOSTILE_CREEPS, 3, 
					{ filter: (c) => { return c.isHostile(); }}));
				if (hostile != null) {
					creep.rangedAttack(hostile);
					creep.attack(hostile);								
				}
				if (Game.time % 15 == 0)
					creep.moveTo(posRally);
			}
		}
	},

	creepRoles: function(listCreeps, tactic) {
		let target_creeps = _.get(tactic, "target_creeps");
		let target_structures = _.get(tactic, "target_structures");
		let target_list = _.get(tactic, "target_list");

		_.each(listCreeps, creep => {
			if (creep.memory.role == "soldier") {
				Roles.Soldier(creep, target_structures, target_creeps, target_list);
			} else if (creep.memory.role == "archer") {
				Roles.Archer(creep, target_structures, target_creeps, target_list);
			} else if (creep.memory.role == "healer") {
				Roles.Healer(creep);
			}
		});
	},

	evaluateDefeat_CreepsWiped: function(combat_id, combat, listCreeps) {
		if (listCreeps.length == 0 && _.get(combat, ["tactic", "spawn_repeat"]) != true) {
			_.set(Memory, ["sites", "combat", combat_id, "state_combat"], "complete");
			console.log(`<font color=\"#FFA100\">[Combat: ${combat_id}]</font> ` 
				+ `Defeat detected by all friendly creeps killed! Stopping attack.`);
			return true;
		}
		return false;
	},

	evaluateVictory_TargetStructures: function(combat_id, combat, room_structures) {
		if (_.get(Game, ["rooms", _.get(combat, "target_room")]) != null) {
			let owned_structures = _.filter(room_structures, s => {
				return s.owner != null && s.structureType != "rampart" });
			
			if (_.get(combat, ["tactic", "target_structures"]) && owned_structures.length == 0) {
				_.set(Memory, ["sites", "combat", combat_id, "state_combat"], "complete");
				console.log(`<font color=\"#FFA100\">[Combat: ${combat_id}]</font> `
					+ `Victory detected by destroying all structures! Stopping attack.`);
				return true;	
			}
		}
		return false;
	},

	evaluateVictory_TargetList: function(combat_id, combat, room_structures) {
		let target_list = _.get(combat, ["tactic", "target_list"]);

		if (target_list != null && _.get(combat, ["tactic", "target_structures"]) == null
				&& _.get(Game, ["rooms", _.get(combat, "target_room")]) != null) {
			let targets_remaining = _.filter(room_structures, s => {
				return target_list.indexOf(s.id) >= 0; });
			
			if (targets_remaining.length == 0) {
				_.set(Memory, ["sites", "combat", combat_id, "state_combat"], "complete");
				console.log(`<font color=\"#FFA100\">[Combat: ${combat_id}]</font> `
					+ `Victory detected by destroying all targets on target list! Stopping attack.`);
				return true;
			}
		}
		return false;
	},

	setOccupation: function(combat_id, combat, tactic) {
		console.log(`<font color=\"#FFA100\">[Combat: ${combat_id}]</font> ` 
			+ `Setting occupation request in Memory; combat_id ${combatID}-occupy.`);
		_.set(Memory, ["sites", "combat", `${combatID}-occupy`], 
			{ colony: combat.colony, target_room: combat.target_room, use_boosts: combat.use_boosts, 
				list_spawns: combat.list_spawns, list_route: combat.list_route, 
				tactic: { type: "occupy", target_creeps: tactic.target_creeps, target_structures: tactic.target_structures, 
					target_list: tactic.target_list } });
	}
};