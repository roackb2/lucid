/**
 * This file was auto-generated by openapi-typescript.
 * Do not make direct changes to the file.
 */

export interface paths {
  "/api/v1/example/helloworld": {
    /** Hello World */
    get: {
      responses: {
        /** OK */
        200: {
          schema: { [key: string]: string };
        };
      };
    };
  };
  "/api/v1/users": {
    /** Creates a new user with the provided details */
    post: {
      parameters: {
        body: {
          /** User details */
          user: definitions["controllers.UserRequest"];
        };
      };
      responses: {
        /** User created successfully */
        201: {
          schema: { [key: string]: string };
        };
        /** Bad request */
        400: {
          schema: { [key: string]: string };
        };
        /** Internal server error */
        500: {
          schema: { [key: string]: string };
        };
      };
    };
  };
  "/healthz": {
    /** Returns the health status of the application */
    get: {
      responses: {
        /** OK */
        200: {
          schema: { [key: string]: string };
        };
      };
    };
  };
}

export interface definitions {
  "controllers.UserRequest": {
    email: string;
    password: string;
    username: string;
  };
}

export interface operations {}

export interface external {}
