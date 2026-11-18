type Option = { readonly value: string; readonly label: string };
export type PeopleCommandModel =
  | { readonly kind: 'cancel'; readonly person: string }
  | {
      readonly kind: 'give';
      readonly members: readonly Option[];
      readonly roles: readonly Option[];
      readonly scopes: readonly Option[];
    }
  | {
      readonly kind: 'give-lobby';
      readonly roles: readonly Option[];
      readonly lobbyName: string;
    }
  | {
      readonly kind: 'remove';
      readonly grants: readonly Option[];
      readonly person: string;
    };
