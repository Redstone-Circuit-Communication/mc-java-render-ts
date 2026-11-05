import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {Schematic} from "nucleation";
import {pairedChestPosition, readBlockInventory, readContainer, textComponent,} from "../dist/inventory.js";
import {countLitematicMaterials} from "../dist/materials.js";

test("typed legacy NBT keeps sparse slots and custom names", () => {
    const item = {
        Compound: {
            Slot: {Byte: 26},
            id: {String: "minecraft:diamond"},
            Count: {Byte: 32},
            tag: {
                Compound: {
                    display: {Compound: {Name: {String: '{"text":"钻石储备"}'}}},
                },
            },
        },
    };
    const r = readContainer("minecraft:chest", {
        Compound: {Items: {List: [item]}},
    });
    assert.equal(r.slots.length, 27);
    assert.equal(r.slots[0], null);
    assert.equal(r.slots[26].count, 32);
    assert.equal(r.slots[26].customName, "钻石储备");
});
test("modern components and item counts", () => {
    const r = readContainer("minecraft:barrel", {
        Items: [
            {
                Slot: 5,
                id: "minecraft:diamond_sword",
                count: 1,
                components: {
                    "minecraft:custom_name": {text: "剑"},
                    "minecraft:enchantments": {levels: {"minecraft:sharpness": 5}},
                },
            },
        ],
    });
    assert.equal(r.slots[5].customName, "剑");
    assert.equal(r.slots[5].enchanted, true);
    assert.equal(r.total, 1);
});
test("invalid slots and duplicates cannot shift or corrupt inventory", () => {
    const r = readContainer("minecraft:hopper", {
        Items: [
            {Slot: -1, id: "minecraft:stone", Count: 1},
            {Slot: 7, id: "minecraft:stone", Count: 1},
            {id: "minecraft:stone", Count: 2},
            {Slot: 0, id: "minecraft:air", Count: 1},
            {Slot: 4, id: "minecraft:coal", Count: 6},
            {Slot: 4, id: "minecraft:coal", Count: 12},
        ],
    });
    assert.equal(r.slots.length, 5);
    assert.equal(r.occupied, 1);
    assert.equal(r.slots[4].count, 12);
    assert.equal(r.warnings.length, 2);
});
test("empty, missing, loot and player storage are distinguishable", () => {
    assert.equal(readContainer("minecraft:chest", {Items: []}).state, "loaded");
    assert.equal(readContainer("minecraft:chest", {}).state, "missing");
    assert.equal(
        readContainer("minecraft:chest", {LootTable: "minecraft:test"}).state,
        "loot",
    );
    assert.equal(readContainer("minecraft:ender_chest", {}).state, "player");
    assert.equal(readContainer("minecraft:stone", {}), null);
});
test("container capacities and modern container component", () => {
    for (const [id, size] of [
        ["purple_shulker_box", 27],
        ["furnace", 3],
        ["dispenser", 9],
        ["brewing_stand", 5],
        ["chiseled_bookshelf", 6],
        ["decorated_pot", 1],
    ])
        assert.equal(readContainer("minecraft:" + id, {Items: []}).size, size);
    assert.equal(
        readContainer("minecraft:barrel", {
            components: {
                "minecraft:container": [
                    {slot: 8, item: {id: "minecraft:book", count: 2}},
                ],
            },
        }).slots[8].count,
        2,
    );
});
test("double chest connection is reciprocal in all facings", () => {
    for (const facing of ["north", "east", "south", "west"]) {
        const p = [7, -2, 9],
            q = pairedChestPosition(`minecraft:chest[facing=${facing},type=left]`, p);
        assert.deepEqual(
            pairedChestPosition(`minecraft:chest[facing=${facing},type=right]`, q),
            p,
        );
    }
});
test("text components remain plain text", () =>
    assert.equal(
        textComponent('{"text":"<img src=x>","extra":[{"text":"abc"}]}'),
        "<img src=x>abc",
    ));

function fixture(file) {
    const data = fs.readFileSync(
            new URL("./fixtures/" + file, import.meta.url),
        ),
        native = Schematic.fromData([...data]),
        map = new Map(
            JSON.parse(native.getAllBlockEntitiesJson()).map((e) => [
                e.position.join(","),
                e,
            ]),
        );
    return {
        data,
        native,
        schematic: {
            schematicWrapper: {
                get_block_string: (...p) => native.getBlockString(...p),
                get_block: (...p) => native.getBlockName(...p),
            },
            getBlockEntitiesMap: () => map,
        },
    };
}

test("real compressed demo: native NBT, double chest order, modern item and material count", async () => {
    const {native, schematic, data} = fixture("inspection-demo.litematic");
    try {
        const chest = readBlockInventory(schematic, [2, 1, 2]).inventory;
        assert.equal(chest.slots[26].id, "minecraft:emerald");
        assert.equal(chest.slots[13].customName, "远航者之剑");
        assert.equal(
            readBlockInventory(schematic, [5, 1, 2]).inventory.slots[26].customName,
            "航海日志",
        );
        const large = readBlockInventory(schematic, [2, 1, 5]).inventory;
        assert.equal(large.size, 54);
        assert.equal(large.slots[0].id, "minecraft:diamond");
        assert.equal(large.slots[53].id, "minecraft:emerald");
        assert.deepEqual(
            readBlockInventory(schematic, [1, 1, 5]).inventory.slots,
            large.slots,
        );
        assert.equal(
            readBlockInventory(schematic, [5, 1, 5]).inventory.occupied,
            0,
        );
        const r = await countLitematicMaterials(
            data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
        );
        assert.equal(r.regionCount, 1);
        assert.equal(
            r.materials.reduce((n, m) => n + m.count, 0),
            180,
        );
    } finally {
        native.clearContents();
    }
});
test("inspect every supported container in the demo blueprint", () => {
    const {native, schematic} = fixture("inspection-demo.litematic");
    try {
        let containers = 0, occupied = 0;
        for (const e of schematic.getBlockEntitiesMap().values()) {
            const r = readBlockInventory(schematic, e.position);
            if (!r.inventory) continue;
            containers++;
            occupied += r.inventory.occupied;
            assert.equal(r.inventory.slots.length, r.inventory.size);
            assert.equal(r.inventory.warnings.length, 0);
        }
        assert.ok(containers > 0, "demo blueprint should contain containers");
        console.log(`Verified ${containers} container entities, ${occupied} occupied slots.`);
    } finally {
        native.clearContents();
    }
});
