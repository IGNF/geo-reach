//! The GTFS feeds of each region, on transport.data.gouv.fr: Île-de-France Mobilités, the regional aggregate of the
//! urban and interurban networks where there is one, elsewhere the national SNCF feed (TER, Intercités, TGV), which is
//! cut to the region, with the main urban networks and the regional coaches. A region's feeds are merged.

pub struct Feed {
    /// What it holds, for the logs
    pub name: &'static str,
    pub url: &'static str,
}

const fn feed(name: &'static str, url: &'static str) -> Feed {
    Feed { name, url }
}

const SNCF: Feed = feed(
    "SNCF (TER, Intercités, TGV)",
    "https://www.data.gouv.fr/api/1/datasets/r/9ae758ec-cd7a-40cd-a890-bb3963224942",
);

/// The feeds of each region
const FEEDS: &[(&str, &[Feed])] = &[
    (
        "ile-de-france",
        &[feed(
            "Île-de-France Mobilités (metro, RER, train, tram, bus)",
            "https://www.data.gouv.fr/api/1/datasets/r/413988ed-d340-467b-8be2-7b999fcd207a",
        )],
    ),
    (
        "normandie",
        &[feed(
            "Agrégat de Normandie (Twisto, Astuce, LiA, Nomad…)",
            "https://transport.data.gouv.fr/resources/81942/download",
        )],
    ),
    (
        "bretagne",
        &[feed(
            "Agrégat de Bretagne",
            "https://www.data.gouv.fr/api/1/datasets/r/8c7b32d0-6481-4bb8-b903-c50a04c72fec",
        )],
    ),
    (
        "pays-de-la-loire",
        &[feed(
            "Agrégat des Pays de la Loire",
            "https://www.data.gouv.fr/api/1/datasets/r/c0bd9ff1-97f9-43f8-aca4-8e80d7728324",
        )],
    ),
    (
        "centre-val-de-loire",
        &[feed(
            "Agrégat du Centre-Val de Loire",
            "https://www.data.gouv.fr/api/1/datasets/r/a193c142-366b-4a7b-8afb-c0bdf23ca7ea",
        )],
    ),
    (
        "grand-est",
        &[feed(
            "Agrégat du Grand Est",
            "https://transport.data.gouv.fr/resources/83634/download",
        )],
    ),
    (
        "nouvelle-aquitaine",
        &[feed(
            "Agrégat de Nouvelle-Aquitaine",
            "https://www.data.gouv.fr/api/1/datasets/r/e09ee736-ae5e-48c8-ac13-3839e3f2f74a",
        )],
    ),
    (
        "auvergne-rhone-alpes",
        &[feed(
            "Agrégat d’Auvergne-Rhône-Alpes",
            "https://www.data.gouv.fr/api/1/datasets/r/231acea2-40cf-4c06-b2eb-646274e0b853",
        )],
    ),
    (
        "hauts-de-france",
        &[
            SNCF,
            feed(
                "Ilévia (Lille)",
                "https://www.data.gouv.fr/api/1/datasets/r/c9e5dd3f-8eed-4ad7-aec2-915240599cf6",
            ),
            feed(
                "Transvilles (Valenciennes)",
                "https://www.data.gouv.fr/api/1/datasets/r/982e0826-4118-42d9-9b73-c3d3b455cd4f",
            ),
            feed(
                "DK’BUS (Dunkerque)",
                "https://www.data.gouv.fr/api/1/datasets/r/f51fabfb-9d7a-44b7-bd03-d1032337fb80",
            ),
            feed(
                "Ametis (Amiens)",
                "https://www.data.gouv.fr/api/1/datasets/r/571e3014-066d-4bd6-9f73-fb8065c928c6",
            ),
        ],
    ),
    (
        "provence-alpes-cote-dazur",
        &[
            SNCF,
            feed(
                "Métropole Aix-Marseille-Provence (RTM, Aix en Bus, Cartreize…)",
                "https://www.data.gouv.fr/api/1/datasets/r/0d9a808a-9a9b-4fa1-b04f-339bbf2cfeb1",
            ),
            feed(
                "Lignes d’Azur (Nice)",
                "https://www.data.gouv.fr/api/1/datasets/r/f5678ab2-c863-4b48-ba1f-9021c7d97634",
            ),
            feed(
                "Mistral (Toulon)",
                "https://www.data.gouv.fr/api/1/datasets/r/b0789d9e-5077-4124-b6b2-773353ada8cf",
            ),
            feed(
                "Orizo (Avignon)",
                "https://www.data.gouv.fr/api/1/datasets/r/40b26c33-9be2-47ea-a46c-8bda9f63273e",
            ),
        ],
    ),
    (
        "occitanie",
        &[
            SNCF,
            feed(
                "Tisséo (Toulouse)",
                "https://www.data.gouv.fr/api/1/datasets/r/64318177-f5b5-4144-a6be-2d0f22d26c77",
            ),
            feed(
                "TaM (Montpellier)",
                "https://www.data.gouv.fr/api/1/datasets/r/93a29ce2-cfc8-44ff-b712-bcfd814b7f00",
            ),
            feed(
                "Tango (Nîmes)",
                "https://www.data.gouv.fr/api/1/datasets/r/15aeb8a5-1cca-4bb9-ae5f-b6e67e4ff2ab",
            ),
            feed(
                "Sankéo (Perpignan)",
                "https://www.data.gouv.fr/api/1/datasets/r/2afffa1f-aa4a-4fe4-9802-4b5f82bb96c6",
            ),
            feed(
                "liO (cars régionaux)",
                "https://www.data.gouv.fr/api/1/datasets/r/d747fe79-2915-4cdd-8cc5-51a810baaca5",
            ),
        ],
    ),
    (
        "bourgogne-franche-comte",
        &[
            SNCF,
            feed(
                "Divia (Dijon)",
                "https://www.data.gouv.fr/api/1/datasets/r/e0dbd217-15cd-4e28-9459-211a27511a34",
            ),
            feed(
                "Ginko (Besançon)",
                "https://www.data.gouv.fr/api/1/datasets/r/e18e0aeb-8805-47fd-bcdb-c226d21c96fe",
            ),
            feed(
                "Mobigo (cars régionaux)",
                "https://www.data.gouv.fr/api/1/datasets/r/28d3c8bf-97f7-40ed-be9f-00e737f74757",
            ),
        ],
    ),
    (
        "corse",
        &[
            feed(
                "Chemins de fer de la Corse",
                "https://www.data.gouv.fr/api/1/datasets/r/69c3db8a-a5fd-471f-b59f-46b9faded381",
            ),
            feed(
                "Via Strada (cars)",
                "https://www.data.gouv.fr/api/1/datasets/r/fe20cb23-34b8-4965-acf7-1b28bf966891",
            ),
            feed(
                "Via Bastia",
                "https://www.data.gouv.fr/api/1/datasets/r/ddbec19b-ed75-42f8-9205-573519298632",
            ),
            feed(
                "A Berlina (Corse-du-Sud)",
                "https://www.data.gouv.fr/api/1/datasets/r/a84de823-7cb2-4d87-917e-e2dda306d280",
            ),
            feed(
                "A Citadina (Sud Corse)",
                "https://www.data.gouv.fr/api/1/datasets/r/74f0577f-f709-49db-9750-53c9341f6e50",
            ),
        ],
    ),
];

/// The feeds of a region, none for an unknown one
pub fn of(region: &str) -> &'static [Feed] {
    FEEDS
        .iter()
        .find(|(id, _)| *id == region)
        .map_or(&[], |(_, feeds)| feeds)
}
