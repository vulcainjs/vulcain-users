import { ITokenService, IQueryUserService } from "../services";
import { VerifyTokenParameter, Model, Property, AbstractActionHandler, ActionHandler, Inject, Action, IContainer, EventNotificationMode } from "vulcain-corejs";
var jwt = require('jsonwebtoken');
var ms = require('ms');

@Model()
export class RenewData {
    @Property({ type: "string", required: true })
    renewToken: string;
}

@ActionHandler({ async: false, scope: "*", serviceName: "TokenService", eventMode: EventNotificationMode.never })
export class TokenHandler extends AbstractActionHandler implements ITokenService {

    private issuer: string;
    // TODO https://github.com/auth0/node-jsonwebtoken
    // Certificate file (SHA 256)

    private secretKey: string;
    // https://github.com/rauchg/ms.js
    private tokenExpiration: string;

    constructor(
        @Inject("Domain") domain,
        @Inject("Container") container: IContainer
    ) {
        super(container);
        this.issuer = process.env["VULCAIN_TOKEN_ISSUER"];
        this.tokenExpiration = process.env["VULCAIN_TOKEN_EXPIRATION"] || "20m";
        this.secretKey = process.env["VULCAIN_SECRET_KEY"] || "DnQBnCG7*fjEX@Rw5uN^hWR4*AkRVKMeRu2#Ucu^ECUNWrKr";
    }

    @Action({ description: "Renew a valid jwt token", action: "renewToken", inputSchema: "RenewData", outputSchema: "string" })
    async renewTokenAsync(data: RenewData): Promise<string> {
        let users = this.container.get<IQueryUserService>("QueryUserService");
        let user = await users.getUserAsync(this.requestContext.tenant, this.requestContext.user.id);
        // No user found with that username
        if (!user || user.disabled) {
            throw new Error("Invalid user");
        }

        try {
            await this.verifyTokenAsync({ apiKey: data.renewToken, tenant: this.requestContext.tenant });
        }
        catch (e) {
            throw new Error("Invalid renew token");
        }

        //let options = { issuer: this.issuer, expiresIn: this.tokenExpiration };

        let result = this.createTokenAsync();
        return result;
    }

    @Action({ description: "Create a new jwt token", action: "createToken", outputSchema: "string" })
    createTokenAsync(): Promise<string> {
        let ctx = this.requestContext;

        return new Promise(async (resolve, reject) => {
            const payload = {
                value:
                {
                    user: {
                        displayName: ctx.user.displayName,
                        id: ctx.user.id,
                        email: ctx.user.email,
                        name: ctx.user.name,
                        tenant: this.requestContext.tenant
                    },
                    scopes: ctx.user.scopes
                }
            };

            let options = { issuer: this.issuer, expiresIn: this.tokenExpiration };

            try {
                let jwtToken = this.createToken(payload, options);
                let renewToken = this.createToken({}, options);

                let expiresIn;
                if (typeof this.tokenExpiration === 'string') {
                    const milliseconds = ms(this.tokenExpiration);
                    expiresIn = Math.floor(milliseconds / 1000);
                }
                else {
                    expiresIn = this.tokenExpiration;
                }
                // token payload contains iat (absolute expiration date in sec)
                resolve({ expiresIn, token: jwtToken, renewToken: renewToken });
            }
            catch (err) {
                reject({ error: err, message: "Error when creating new token for user :" + ctx.user.name + " - " + (err.message || err) });
            }
        });
    }

    private createToken(payload, options) {
        let token;
        token = jwt.sign(payload, this.secretKey, options);
        return token;
    }

    verifyTokenAsync(jwtToken: VerifyTokenParameter): Promise<any> {
        return new Promise(async (resolve, reject) => {
            if (!jwtToken) {
                reject("You must provided a valid token");
                return;
            }
            let options: any = { "issuer": this.issuer };

            try {
                let key = this.secretKey;
                //options.algorithms=[ALGORITHM];

                jwt.verify(jwtToken, key, options, (err, payload) => {
                    if (err) {
                        reject(err);
                    }
                    else {
                        const token = payload.value;
                        if (token.user.tenant !== this.requestContext.tenant) {
                            reject({ message: "Invalid tenant" });
                        }
                        else {
                            resolve(token);
                        }
                    }
                });
            }
            catch (err) {
                reject({ error: err, message: "Invalid JWT token" });
            }
        });
    }
}
